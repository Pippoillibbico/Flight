import { z } from 'zod';
import { getRouteBaselinePercentiles } from './deal-engine-store.js';
import { canonicalScoreFromPercentiles, legacyLevelFromBadge, mapLimit } from './discovery-score.js';
import { listPopularRoutesByOrigin } from './price-history-store.js';
import { logger } from './logger.js';

/**
 * @typedef {{ destination: string, avg_price: number, observations: number, deal_score: number, deal_type: string, score: number }} DiscoveryItem
 */

const cheapestSchema = z.object({
  origin: z.string().trim().length(3),
  month: z.string().trim().regex(/^\d{4}-\d{2}$/),
  limit: z.number().int().min(1).max(50).default(12)
});

const routesSchema = z.object({
  origin: z.string().trim().length(3),
  limit: z.number().int().min(1).max(50).default(20)
});

function monthStartToday() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

async function getBaselineForRouteMonth({ origin, destination, travelMonth }) {
  const baseline = await getRouteBaselinePercentiles({
    originIata: origin,
    destinationIata: destination,
    travelMonth
  });
  return baseline;
}

function scoreForDiscovery({ avgPrice, dealScore, observations, underrated = false }) {
  const priceScore = Math.max(0, Math.min(100, 100 - avgPrice / 8));
  const volumePenalty = Math.min(30, Math.max(0, observations / 12));
  const underratedBoost = underrated ? 14 : 0;
  return Math.max(0, Math.min(100, Math.round(priceScore * 0.35 + dealScore * 0.55 - volumePenalty + underratedBoost)));
}

export async function findCheapestDestinations(origin, month, limit = 12) {
  const parsed = cheapestSchema.parse({ origin, month, limit });
  try {
    const travelMonth = `${parsed.month}-01`;
    const rows = await listPopularRoutesByOrigin({ origin: parsed.origin, month: `${parsed.month}-01`, limit: parsed.limit * 3 });
    const scored = await mapLimit(rows, 8, async (row) => {
      const baseline = await getBaselineForRouteMonth({ origin: parsed.origin, destination: row.destination, travelMonth });
      if (!baseline) return null;
      const canonical = canonicalScoreFromPercentiles({
        p10: Number(baseline?.p10_price),
        p25: Number(baseline?.p25_price),
        p50: Number(baseline?.p50_price),
        p75: Number(baseline?.p75_price),
        p90: Number(baseline?.p90_price),
        observationCount: Number(baseline?.observation_count || row.observations || 0),
        price: Number(row.avgPrice),
        travelMonth
      });
      if (canonical.visibility === 'hidden') return null;
      return {
        destination: row.destination,
        avg_price: row.avgPrice,
        observations: row.observations,
        deal_score: canonical.score,
        deal_type: canonical.badge.toLowerCase(),
        badge: canonical.badge,
        reasons: canonical.reasons,
        confidence: canonical.confidence,
        visibility: canonical.visibility,
        deal_level: legacyLevelFromBadge({ badge: canonical.badge, price: Number(row.avgPrice), p75: Number(baseline?.p75_price || row.avgPrice) }),
        score: scoreForDiscovery({
          avgPrice: Number(row.avgPrice),
          dealScore: canonical.score,
          observations: row.observations
        })
      };
    });
    scored.forEach((item) => {
      if (!item) return;
      logger.info(
        {
          origin: parsed.origin,
          destination: item.destination,
          travelMonth,
          score: item.deal_score,
          badge: item.badge,
          confidenceLevel: item.confidence?.level || 'very_low',
          observationCount: Number(item.confidence?.observationCount || 0),
          visibility: item.visibility
        },
        'discovery_cheapest_scored'
      );
    });
    return scored.filter(Boolean).sort((a, b) => b.score - a.score || a.avg_price - b.avg_price).slice(0, parsed.limit);
  } catch (error) {
    logger.error({ err: error, origin: parsed.origin, month: parsed.month }, 'find_cheapest_destinations_failed');
    throw error;
  }
}

/**
 * Finds underexposed routes with good local deal profile.
 * @param {string} origin
 * @param {number=} limit
 * @returns {Promise<DiscoveryItem[]>}
 */
export async function findUnderratedRoutes(origin, limit = 20) {
  const parsed = routesSchema.parse({ origin, limit });
  try {
    const travelMonth = monthStartToday();
    const rows = await listPopularRoutesByOrigin({ origin: parsed.origin, limit: parsed.limit * 4 });
    const computed = await mapLimit(rows, 8, async (row) => {
      if (row.observations > 250) return null;
      const baseline = await getBaselineForRouteMonth({ origin: parsed.origin, destination: row.destination, travelMonth });
      if (!baseline) return null;
      const canonical = canonicalScoreFromPercentiles({
        p10: Number(baseline?.p10_price),
        p25: Number(baseline?.p25_price),
        p50: Number(baseline?.p50_price),
        p75: Number(baseline?.p75_price),
        p90: Number(baseline?.p90_price),
        observationCount: Number(baseline?.observation_count || row.observations || 0),
        price: Number(row.avgPrice),
        travelMonth
      });
      if (canonical.visibility === 'hidden') return null;
      return {
        destination: row.destination,
        avg_price: row.avgPrice,
        observations: row.observations,
        deal_score: canonical.score,
        deal_type: canonical.badge.toLowerCase(),
        badge: canonical.badge,
        reasons: canonical.reasons,
        confidence: canonical.confidence,
        visibility: canonical.visibility,
        deal_level: legacyLevelFromBadge({ badge: canonical.badge, price: Number(row.avgPrice), p75: Number(baseline?.p75_price || row.avgPrice) }),
        score: scoreForDiscovery({
          avgPrice: Number(row.avgPrice),
          dealScore: canonical.score,
          observations: row.observations,
          underrated: true
        })
      };
    });
    const out = computed.filter(Boolean);
    out.forEach((item) => {
      logger.info(
        {
          origin: parsed.origin,
          destination: item.destination,
          travelMonth,
          score: item.deal_score,
          badge: item.badge,
          confidenceLevel: item.confidence?.level || 'very_low',
          observationCount: Number(item.confidence?.observationCount || 0),
          visibility: item.visibility
        },
        'discovery_underrated_scored'
      );
    });
    return out.sort((a, b) => b.score - a.score).slice(0, parsed.limit);
  } catch (error) {
    logger.error({ err: error, origin: parsed.origin }, 'find_underrated_routes_failed');
    throw error;
  }
}

/**
 * Finds strongest price-drop candidates from local historical baseline.
 * @param {string} origin
 * @param {number=} limit
 * @returns {Promise<Array<DiscoveryItem & { price_drop_pct: number }>>}
 */
export async function findPriceDrops(origin, limit = 20) {
  const parsed = routesSchema.parse({ origin, limit });
  try {
    const travelMonth = monthStartToday();
    const rows = await listPopularRoutesByOrigin({ origin: parsed.origin, limit: parsed.limit * 4 });
    const computed = await mapLimit(rows, 8, async (row) => {
      const baseline = await getBaselineForRouteMonth({ origin: parsed.origin, destination: row.destination, travelMonth });
      if (!baseline) return null;
      const baselineP50 = Number(baseline?.p50_price || 0);
      const drop = baselineP50 > 0 ? Math.max(0, ((baselineP50 - Number(row.avgPrice)) / baselineP50) * 100) : 0;
      if (drop < 8) return null;
      const canonical = canonicalScoreFromPercentiles({
        p10: Number(baseline?.p10_price),
        p25: Number(baseline?.p25_price),
        p50: baselineP50,
        p75: Number(baseline?.p75_price),
        p90: Number(baseline?.p90_price),
        observationCount: Number(baseline?.observation_count || row.observations || 0),
        price: Number(row.avgPrice),
        travelMonth
      });
      if (canonical.visibility === 'hidden') return null;
      return {
        destination: row.destination,
        avg_price: row.avgPrice,
        observations: row.observations,
        price_drop_pct: drop,
        deal_score: canonical.score,
        deal_type: canonical.badge.toLowerCase(),
        badge: canonical.badge,
        reasons: canonical.reasons,
        confidence: canonical.confidence,
        visibility: canonical.visibility,
        deal_level: legacyLevelFromBadge({ badge: canonical.badge, price: Number(row.avgPrice), p75: Number(baseline?.p75_price || row.avgPrice) }),
        score: scoreForDiscovery({
          avgPrice: Number(row.avgPrice),
          dealScore: canonical.score,
          observations: row.observations
        })
      };
    });
    const out = computed.filter(Boolean);
    out.forEach((item) => {
      logger.info(
        {
          origin: parsed.origin,
          destination: item.destination,
          travelMonth,
          score: item.deal_score,
          badge: item.badge,
          confidenceLevel: item.confidence?.level || 'very_low',
          observationCount: Number(item.confidence?.observationCount || 0),
          visibility: item.visibility
        },
        'discovery_price_drop_scored'
      );
    });
    return out.sort((a, b) => b.price_drop_pct - a.price_drop_pct || b.score - a.score).slice(0, parsed.limit);
  } catch (error) {
    logger.error({ err: error, origin: parsed.origin }, 'find_price_drops_failed');
    throw error;
  }
}
