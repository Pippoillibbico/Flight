/**
 * kiwi-provider.js
 *
 * Kiwi.com flight search adapter via the Tequila API.
 *
 * Tequila API docs: https://tequila.kiwi.com/portal/docs/tequila_api/search
 * Auth: API key in `apikey` header (obtained via Kiwi.com partner portal).
 *
 * This adapter is DISABLED by default.
 * Enable via: ENABLE_PROVIDER_KIWI=true  +  KIWI_TEQUILA_API_KEY=<key>
 *
 * Integration status:
 *   - Code complete and ready for commercial activation.
 *   - Requires Tequila partner account: https://tequila.kiwi.com/portal
 *   - No hard dependency — if unconfigured the provider returns [] gracefully.
 */

import { BaseProvider } from './base-provider.js';

const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const DEFAULT_TIMEOUT_MS = Math.max(3000, Math.min(20000, Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS || 12000)));
const DEFAULT_RETRIES = Math.max(0, Math.min(IS_PRODUCTION ? 1 : 4, Number(process.env.PROVIDER_REQUEST_RETRIES || (IS_PRODUCTION ? 1 : 2))));

const MAX_OFFERS_PER_REQUEST = 20;

const KIWI_SEARCH_BASE = 'https://tequila.kiwi.com/v2/search';

// Map internal cabin class → Tequila selected_cabins values
const CABIN_MAP = {
  economy:          'M',    // Economy
  premium:          'W',    // Premium economy
  premium_economy:  'W',
  business:         'C',    // Business
  first:            'F'     // First
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
  throw new Error('Kiwi/Tequila request failed after retries.');
}

/**
 * Parse a total duration string like "2h 30m" or "150" (minutes) into minutes.
 * Tequila returns flight_duration as string "2:30" (HH:MM).
 */
function parseDurationMinutes(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  // HH:MM format
  const colonMatch = text.match(/^(\d+):(\d{2})$/);
  if (colonMatch) {
    const total = Number(colonMatch[1]) * 60 + Number(colonMatch[2]);
    return Number.isFinite(total) && total > 0 ? total : null;
  }

  // Plain number (assume minutes)
  const plain = Number(text);
  if (Number.isFinite(plain) && plain > 0) return plain;

  return null;
}

/**
 * Format a Date or ISO string to YYYY-MM-DD.
 */
function toYMD(value) {
  if (!value) return null;
  const s = String(value).trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Unix timestamp (seconds)
  const ts = Number(s);
  if (Number.isFinite(ts) && ts > 0) {
    return new Date(ts * 1000).toISOString().slice(0, 10);
  }
  return null;
}

export class KiwiProvider extends BaseProvider {
  constructor({ apiKey, enabled } = {}) {
    super('kiwi');
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
   * Search for flights via Tequila API.
   *
   * Tequila uses GET /v2/search with query parameters.
   * Dates are in DD/MM/YYYY format for the API.
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

    const cabin = CABIN_MAP[String(cabinClass).toLowerCase()] || 'M';

    // Tequila expects DD/MM/YYYY date range.
    // We use the same day as both from and to to pin an exact date.
    function toTequilaDate(isoStr) {
      if (!isoStr) return null;
      const [y, m, d] = String(isoStr).slice(0, 10).split('-');
      return `${d}/${m}/${y}`;
    }

    const depTequila = toTequilaDate(departureDate);
    if (!depTequila) return [];

    const params = new URLSearchParams({
      fly_from:          String(originIata).toUpperCase(),
      fly_to:            String(destinationIata).toUpperCase(),
      date_from:         depTequila,
      date_to:           depTequila,
      curr:              'EUR',
      adults:            String(Math.max(1, Number(adults) || 1)),
      vehicle_type:      'aircraft',
      max_stopovers:     '2',
      limit:             String(MAX_OFFERS_PER_REQUEST),
      sort:              'price',
      asc:               '1',
      selected_cabins:   cabin,
      mix_with_cabins:   '',     // strict cabin — no mixing
      partner_market:    'us'
    });

    const tripType = returnDate ? 'round_trip' : 'one_way';

    if (returnDate) {
      const retTequila = toTequilaDate(returnDate);
      if (!retTequila) return [];
      params.set('return_from', retTequila);
      params.set('return_to',   retTequila);
      params.set('flight_type', 'round');
    } else {
      params.set('flight_type', 'oneway');
    }

    const url = `${KIWI_SEARCH_BASE}?${params.toString()}`;

    const response = await fetchWithTimeoutRetry(url, {
      method:  'GET',
      headers: {
        apikey: this.apiKey,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Kiwi/Tequila request failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const json = await response.json();
    const rawOffers = Array.isArray(json?.data) ? json.data : [];

    return rawOffers
      .filter((o) => Number.isFinite(Number(o?.price)) && Number(o.price) > 0)
      .slice(0, MAX_OFFERS_PER_REQUEST)
      .map((offer) => {
        const routes     = Array.isArray(offer.route) ? offer.route : [];
        const totalStops = Math.max(0, routes.length - (returnDate ? 2 : 1));

        const durationMin = parseDurationMinutes(offer.duration?.total || offer.fly_duration);

        // Kiwi returns departure as Unix timestamp in local_departure (ISO) or dTime (epoch)
        const actualDep = toYMD(offer.local_departure || (offer.dTime ? String(offer.dTime) : null));
        const actualRet = returnDate
          ? toYMD(offer.local_arrival || (offer.aTime ? String(offer.aTime) : null))
          : null;

        return this.normalizeOffer({
          originIata:      String(offer.flyFrom || originIata).toUpperCase(),
          destinationIata: String(offer.flyTo   || destinationIata).toUpperCase(),
          departureDate:   actualDep || departureDate,
          returnDate:      returnDate ? (actualRet || returnDate) : null,
          currency:        String(offer.currency || 'EUR').toUpperCase(),
          totalPrice:      Number(offer.price),
          provider:        'kiwi',
          cabinClass:      String(cabinClass).toLowerCase(),
          tripType,
          source:          'partner_feed',
          metadata: {
            kiwiBookingToken: offer.booking_token || null,
            kiwiDeepLink:     offer.deep_link      || null,
            totalStops,
            durationMinutes:  durationMin,
            airlines:         routes.map((r) => r.airline).filter(Boolean)
          }
        });
      })
      .filter((item) => Number.isFinite(item.totalPrice) && item.totalPrice > 0);
  }
}
