/**
 * skyscanner-provider.js
 *
 * Skyscanner flight search adapter via the official Partners API v3.
 *
 * Partners API docs: https://developers.skyscanner.net/docs/intro
 * Auth: API key as `x-api-key` header (obtained via Skyscanner Partner portal).
 *
 * This adapter is DISABLED by default.
 * Enable via: ENABLE_PROVIDER_SKYSCANNER=true  +  SKYSCANNER_API_KEY=<key>
 *
 * Integration status:
 *   - Code complete and ready for commercial activation.
 *   - Requires Skyscanner Partners agreement: https://www.partners.skyscanner.net/
 *   - No hard dependency — if unconfigured the provider returns [] gracefully.
 *
 * API flow (Partners v3 — Live Prices):
 *   1. POST /flights/live/search/create  → sessionToken
 *   2. POST /flights/live/search/poll/:sessionToken  → itineraries
 *
 * We keep the initial poll delay at 1.5s by default so two poll cycles can
 * complete under the provider timeout budget (default 12s) without opening
 * the provider circuit on healthy but slow responses.
 */

import { BaseProvider } from './base-provider.js';

const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const DEFAULT_TIMEOUT_MS = Math.max(3000, Math.min(20000, Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS || 12000)));
const DEFAULT_RETRIES = Math.max(0, Math.min(IS_PRODUCTION ? 1 : 4, Number(process.env.PROVIDER_REQUEST_RETRIES || (IS_PRODUCTION ? 1 : 2))));

// How many ms to wait between session create and first poll.
// Skyscanner's polling model needs a short settle time.
const POLL_INITIAL_DELAY_MS = Number(process.env.SKYSCANNER_POLL_DELAY_MS || 1500);

// How many poll attempts before giving up
const MAX_POLL_ATTEMPTS     = Math.max(1, Number(process.env.SKYSCANNER_MAX_POLLS || 2));

const MAX_OFFERS_PER_REQUEST = 20;

const SKYSCANNER_BASE = 'https://partners.api.skyscanner.net/apiservices/v3';

// Map internal cabin class → Skyscanner cabinClass enum
const CABIN_MAP = {
  economy:         'CABIN_CLASS_ECONOMY',
  premium:         'CABIN_CLASS_PREMIUM_ECONOMY',
  premium_economy: 'CABIN_CLASS_PREMIUM_ECONOMY',
  business:        'CABIN_CLASS_BUSINESS',
  first:           'CABIN_CLASS_FIRST'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status) {
  return Number(status) === 429 || (Number(status) >= 500 && Number(status) <= 599);
}

async function fetchWithTimeoutRetry(url, options = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.ok) return response;
      if (!shouldRetry(response.status) || attempt === retries) return response;
    } catch (err) {
      if (attempt === retries) throw err;
    } finally {
      clearTimeout(timer);
    }
    await sleep(250 * 2 ** attempt);
  }
  throw new Error('Skyscanner request failed after retries.');
}

/**
 * Build a Skyscanner v3 "leg" object for a single flight direction.
 */
function buildLeg(originIata, destinationIata, dateISO) {
  return {
    originPlaceId: { iata: String(originIata).toUpperCase() },
    destinationPlaceId: { iata: String(destinationIata).toUpperCase() },
    date: {
      year:  Number(dateISO.slice(0, 4)),
      month: Number(dateISO.slice(5, 7)),
      day:   Number(dateISO.slice(8, 10))
    }
  };
}

/**
 * Extract a price amount from a Skyscanner v3 itinerary's price object.
 * Price is expressed as { amount, unit } where unit is typically PRICE_UNIT_WHOLE or PRICE_UNIT_MILLI.
 */
function parseSkyscannerPrice(priceObj) {
  if (!priceObj) return null;
  const raw = Number(priceObj.amount);
  if (!Number.isFinite(raw)) return null;
  const unit = String(priceObj.unit || '').toUpperCase();
  // PRICE_UNIT_MILLI = value / 1000
  if (unit === 'PRICE_UNIT_MILLI') return raw / 1000;
  return raw;
}

/**
 * Extract total stops and duration from legs/segments in a Skyscanner itinerary.
 * Itinerary shape (v3): { legs: [{ legId, ... }] } — segment details are in a separate legs dict.
 */
function parseLegMeta(legId, legsDict) {
  const leg = legsDict?.[legId];
  if (!leg) return { stops: 0, durationMinutes: null };

  const stops = Math.max(0, Number(leg.stopCount || 0));
  const durationMinutes = Number.isFinite(Number(leg.durationInMinutes)) && leg.durationInMinutes > 0
    ? Number(leg.durationInMinutes)
    : null;
  return { stops, durationMinutes };
}

export class SkyscannerProvider extends BaseProvider {
  constructor({ apiKey, enabled } = {}) {
    super('skyscanner');
    this.apiKey  = String(apiKey  || '').trim();
    this.enabled = Boolean(enabled);
  }

  isEnabled() {
    return this.enabled;
  }

  isConfigured() {
    return this.apiKey.length > 0;
  }

  /**
   * Search for flights via Skyscanner Partners API v3 (live prices).
   *
   * @param {{
   *   originIata: string,
   *   destinationIata: string,
   *   departureDate: string,   // YYYY-MM-DD
   *   returnDate?: string|null, // YYYY-MM-DD
   *   adults?: number,
   *   cabinClass?: string
   * }} params
   * @returns {Promise<Array>}
   */
  async searchOffers({ originIata, destinationIata, departureDate, returnDate, adults = 1, cabinClass = 'economy' }) {
    if (!this.isEnabled() || !this.isConfigured()) return [];

    const cabinEnum = CABIN_MAP[String(cabinClass).toLowerCase()] || 'CABIN_CLASS_ECONOMY';
    const pax = Math.max(1, Number(adults) || 1);
    const tripType = returnDate ? 'round_trip' : 'one_way';

    // ── Step 1: Create session ────────────────────────────────────────────────
    const createPayload = {
      query: {
        market:   'UK',
        locale:   'en-GB',
        currency: 'EUR',
        queryLegs: [
          buildLeg(originIata, destinationIata, departureDate)
        ],
        adults:    pax,
        cabinClass: cabinEnum
      }
    };

    if (returnDate) {
      createPayload.query.queryLegs.push(buildLeg(destinationIata, originIata, returnDate));
    }

    const createResponse = await fetchWithTimeoutRetry(
      `${SKYSCANNER_BASE}/flights/live/search/create`,
      {
        method:  'POST',
        headers: {
          'x-api-key':    this.apiKey,
          'Content-Type': 'application/json',
          Accept:         'application/json'
        },
        body: JSON.stringify(createPayload)
      }
    );

    if (!createResponse.ok) {
      const body = await createResponse.text().catch(() => '');
      throw new Error(`Skyscanner create session failed (${createResponse.status}): ${body.slice(0, 200)}`);
    }

    const createJson = await createResponse.json();
    const sessionToken = createJson?.sessionToken;
    if (!sessionToken) {
      throw new Error('Skyscanner create session returned no sessionToken');
    }

    // ── Step 2: Poll for results ──────────────────────────────────────────────
    // Wait before first poll to let Skyscanner aggregate carrier responses.
    if (POLL_INITIAL_DELAY_MS > 0) await sleep(POLL_INITIAL_DELAY_MS);

    let itineraries = [];
    let legsDict    = {};

    for (let poll = 0; poll < MAX_POLL_ATTEMPTS; poll += 1) {
      const pollResponse = await fetchWithTimeoutRetry(
        `${SKYSCANNER_BASE}/flights/live/search/poll/${encodeURIComponent(sessionToken)}`,
        {
          method:  'POST',
          headers: {
            'x-api-key':    this.apiKey,
            'Content-Type': 'application/json',
            Accept:         'application/json'
          },
          body: JSON.stringify({})
        }
      );

      if (!pollResponse.ok) {
        const body = await pollResponse.text().catch(() => '');
        throw new Error(`Skyscanner poll failed (${pollResponse.status}): ${body.slice(0, 200)}`);
      }

      const pollJson = await pollResponse.json();

      // v3 response shape: { status, content: { results: { itineraries: {…}, legs: {…} } } }
      const results = pollJson?.content?.results;
      if (results?.itineraries) {
        itineraries = Object.values(results.itineraries);
        legsDict    = results.legs || {};
      }

      const status = String(pollJson?.status || '').toUpperCase();
      // RESULT_STATUS_COMPLETE = final; RESULT_STATUS_INCOMPLETE = still aggregating
      if (status === 'RESULT_STATUS_COMPLETE') break;
      if (poll < MAX_POLL_ATTEMPTS - 1) await sleep(1500);
    }

    if (itineraries.length === 0) return [];

    // Sort cheapest first, then cap
    return itineraries
      .filter((it) => it?.pricingOptions?.length > 0)
      .map((it) => {
        const bestPrice = it.pricingOptions
          .map((opt) => parseSkyscannerPrice(opt?.price))
          .filter((p) => Number.isFinite(p) && p > 0)
          .sort((a, b) => a - b)[0];

        if (!Number.isFinite(bestPrice) || bestPrice <= 0) return null;

        const legIds = Array.isArray(it.legIds) ? it.legIds : [];
        const outLeg = parseLegMeta(legIds[0], legsDict);
        const retLeg = legIds[1] ? parseLegMeta(legIds[1], legsDict) : { stops: 0, durationMinutes: null };

        const totalStops = outLeg.stops + retLeg.stops;
        const totalDuration = (outLeg.durationMinutes || 0) + (retLeg.durationMinutes || 0);

        return this.normalizeOffer({
          originIata:      String(originIata).toUpperCase(),
          destinationIata: String(destinationIata).toUpperCase(),
          departureDate,
          returnDate:      returnDate || null,
          currency:        'EUR',
          totalPrice:      bestPrice,
          provider:        'skyscanner',
          cabinClass:      String(cabinClass).toLowerCase(),
          tripType,
          source:          'partner_feed',
          metadata: {
            itineraryId:        it.itineraryId || null,
            sessionToken,
            totalStops,
            outboundStops:      outLeg.stops,
            inboundStops:       retLeg.stops,
            durationMinutesOutbound: outLeg.durationMinutes,
            durationMinutesInbound:  retLeg.durationMinutes,
            totalDurationMinutes: totalDuration > 0 ? totalDuration : null
          }
        });
      })
      .filter((item) => item !== null && Number.isFinite(item.totalPrice) && item.totalPrice > 0)
      .sort((a, b) => a.totalPrice - b.totalPrice)
      .slice(0, MAX_OFFERS_PER_REQUEST);
  }
}
