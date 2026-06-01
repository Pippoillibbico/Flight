import { assertPaidCapability } from '../../lib/plan-capabilities.js';
import { parseTriangulationPrompt } from './ai-triangulation-parser.js';
import { explainTriangulationResults } from './ai-triangulation-explainer.js';
import { buildFreeTriangulationPayload } from './triangulation-cache.js';
import { generateTriangulationCandidates, getTriangulationLimits } from './route-generator.js';
import { scoreTriangulation } from './route-scorer.js';
import { logger } from '../../lib/logger.js';

const TRIANGULATION_PROVIDER_UNAVAILABLE = 'TRIANGULATION_PROVIDER_UNAVAILABLE';

function classifyProviderFailure(error) {
  const text = `${String(error?.code || '')} ${String(error?.name || '')} ${String(error?.message || '')}`.toLowerCase();
  if (text.includes('timeout')) return 'timeout';
  if (text.includes('rate') || text.includes('429')) return 'rate_limited';
  if (text.includes('circuit')) return 'circuit_open';
  if (text.includes('auth') || text.includes('unauthor') || text.includes('forbidden') || text.includes('401') || text.includes('403')) return 'authentication_failed';
  return 'provider_failed';
}

function isTriangulationLiveEnabled() {
  return String(process.env.TRIANGULATION_LIVE_ENABLED || 'false').trim().toLowerCase() === 'true';
}

function readOffer(payload) {
  const source = Array.isArray(payload?.offers) ? payload.offers[0] : Array.isArray(payload?.items) ? payload.items[0] : Array.isArray(payload) ? payload[0] : payload;
  if (!source || typeof source !== 'object') return null;
  const price = Number(source.price ?? source.totalPrice ?? source.amount ?? source.total_amount);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    price,
    provider: String(source.provider || source.source || 'provider_name'),
    airline: String(source.airline || source.carrier || 'Example Airline'),
    departure: source.departure || source.departureTime || null,
    arrival: source.arrival || source.arrivalTime || null,
    raw: source
  };
}

function addHours(isoDate, hours) {
  const date = new Date(`${isoDate}T08:30:00Z`);
  return new Date(date.getTime() + hours * 3600000).toISOString().slice(0, 19);
}

async function searchLeg(providerSearch, leg) {
  const payload = await providerSearch({
    origin: leg.from,
    destination: leg.to,
    departureDate: leg.date,
    travellers: leg.travellers,
    cabinClass: leg.cabinClass
  });
  return readOffer(payload);
}

function buildSegment({ from, to, date, offer, departOffsetHours = 0, durationHours = 2 }) {
  return {
    from,
    to,
    departure: offer.departure || addHours(date, departOffsetHours),
    arrival: offer.arrival || addHours(date, departOffsetHours + durationHours),
    price: Math.round(Number(offer.price)),
    provider: offer.provider,
    airline: offer.airline
  };
}

export function createTriangulationService({ providerSearch = null, aiRunner = null, liveEnabled = isTriangulationLiveEnabled(), limits = {} } = {}) {
  async function intake(req, input) {
    const guard = await assertPaidCapability(req, 'triangulation_live');
    if (guard.upgradeRequired) {
      // FREE plan must never trigger paid variable-cost capabilities.
      return buildFreeTriangulationPayload({ allowedCapabilities: guard.allowedCapabilities });
    }
    const { parsed, source } = await parseTriangulationPrompt({ ...input, aiRunner });
    return {
      mode: 'parsed_live',
      paidCostUsed: source === 'ai',
      upgradeRequired: false,
      parsed,
      parserSource: source
    };
  }

  async function search(req, input) {
    const guard = await assertPaidCapability(req, 'triangulation_live');
    if (guard.upgradeRequired) {
      // FREE plan must never trigger paid variable-cost capabilities.
      return buildFreeTriangulationPayload({ origin: input.origin, destination: input.destination, allowedCapabilities: guard.allowedCapabilities });
    }
    if (!liveEnabled || typeof providerSearch !== 'function') {
      return {
        mode: 'live_unavailable',
        paidCostUsed: false,
        upgradeRequired: false,
        reason: 'triangulation_live_provider_unavailable',
        message: 'Triangulation live is enabled for paid plans, but no live provider is configured.'
      };
    }

    const effectiveLimits = getTriangulationLimits(limits);
    const maxBridgeStops = req.user?.planType === 'elite' || req.user?.planType === 'creator' ? input.maxBridgeStops : 1;
    const { candidates, meta } = generateTriangulationCandidates({ ...input, maxBridgeStops }, effectiveLimits);
    try {
      const baselineOffer = await searchLeg(providerSearch, {
        from: input.origin,
        to: input.destination,
        date: candidates[0]?.date || input.period?.month + '-10',
        travellers: input.travellers,
        cabinClass: input.cabinClass
      });
      if (!baselineOffer) {
        return {
          mode: 'live_unavailable',
          paidCostUsed: true,
          upgradeRequired: false,
          reason: 'baseline_provider_offer_missing',
          message: 'Provider response did not include a usable baseline price.',
          results: []
        };
      }

      const results = [];
      for (const candidate of candidates) {
        if (results.length >= effectiveLimits.maxResults) break;
        const bridge = candidate.bridges[0];
        const first = await searchLeg(providerSearch, {
          from: candidate.origin,
          to: bridge.iata,
          date: candidate.date,
          travellers: input.travellers,
          cabinClass: input.cabinClass
        });
        const second = await searchLeg(providerSearch, {
          from: bridge.iata,
          to: candidate.destination,
          date: candidate.date,
          travellers: input.travellers,
          cabinClass: input.cabinClass
        });
        if (!first || !second) continue;
        const layoverHours = Math.max(Number(bridge.minLayoverHoursSeparateTickets || 6), Number(process.env.TRIANGULATION_MIN_LAYOVER_SEPARATE_TICKETS_HOURS || 6));
        const totalPrice = Math.round(first.price + second.price);
        const totalDurationHours = Math.round((layoverHours + 2.1 + 12.4) * 10) / 10;
        const scored = scoreTriangulation({
          baselinePrice: baselineOffer.price,
          totalPrice,
          totalDurationHours,
          layoverHours,
          separateTickets: true,
          airportChange: false,
          baggage: input.baggage,
          bridgeRisk: bridge.riskProfile
        });
        if (scored.savingVsBaseline <= 0 && input.goal === 'lowest_price') continue;
        results.push({
          id: candidate.id,
          route: candidate.route.join('-'),
          segments: [
            buildSegment({ from: candidate.origin, to: bridge.iata, date: candidate.date, offer: first, departOffsetHours: 0, durationHours: 2.1 }),
            buildSegment({ from: bridge.iata, to: candidate.destination, date: candidate.date, offer: second, departOffsetHours: 2.1 + layoverHours, durationHours: 12.4 })
          ],
          totalPrice,
          savingVsBaseline: scored.savingVsBaseline,
          savingPercent: scored.savingPercent,
          totalDurationHours,
          layoverHours,
          separateTickets: true,
          airportChange: false,
          baggageCompatibility: input.baggage === 'checked' ? 'checked_baggage_not_recommended' : 'personal_item_recommended',
          risk: scored.risk,
          score: scored.score,
          recommended: scored.score >= 70,
          warnings: scored.warnings
        });
      }

      results.sort((a, b) => b.score - a.score || a.totalPrice - b.totalPrice);
      const explanation = await explainTriangulationResults({ results, aiRunner });
      const finalResults = results.map((result, index) => ({
        ...result,
        aiSummary: index === 0 ? explanation.summary : undefined
      }));
      return {
        mode: 'live_triangulation',
        paidCostUsed: true,
        upgradeRequired: false,
        baseline: {
          route: `${input.origin}-${input.destination}`,
          totalPrice: Math.round(baselineOffer.price),
          source: baselineOffer.provider || 'provider_or_cache',
          isLive: true
        },
        results: finalResults,
        explanation,
        meta
      };
    } catch (error) {
      logger.warn(
        { failureCategory: classifyProviderFailure(error) },
        'triangulation_provider_search_failed'
      );
      return {
        mode: 'live_error',
        paidCostUsed: true,
        upgradeRequired: false,
        reason: 'triangulation_provider_failed',
        message: 'Live triangulation is temporarily unavailable.',
        error: TRIANGULATION_PROVIDER_UNAVAILABLE
      };
    }
  }

  return { intake, search };
}
