import { BaseProvider } from './base-provider.js';

const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const DEFAULT_TIMEOUT_MS = Math.max(3000, Math.min(20000, Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS || 12000)));
// Keep retries conservative in production to avoid runaway provider spend.
const DEFAULT_RETRIES = Math.max(0, Math.min(IS_PRODUCTION ? 1 : 4, Number(process.env.PROVIDER_REQUEST_RETRIES || (IS_PRODUCTION ? 1 : 2))));

// Max offers to keep per request (sorted cheapest-first before this cap)
const MAX_OFFERS_PER_REQUEST = 20;

// Cabin class mapping: internal app values → Duffel API values
const CABIN_CLASS_MAP = {
  economy: 'economy',
  premium: 'premium_economy',
  premium_economy: 'premium_economy',
  business: 'business',
  first: 'first'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status) {
  return Number(status) === 429 || (Number(status) >= 500 && Number(status) <= 599);
}

function parseIsoDurationMinutes(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return null;
  const m = text.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
  if (!m) return null;
  const days = Number(m[1] || 0);
  const hours = Number(m[2] || 0);
  const minutes = Number(m[3] || 0);
  const out = days * 24 * 60 + hours * 60 + minutes;
  return Number.isFinite(out) && out > 0 ? out : null;
}

async function fetchWithTimeoutRetry(url, options = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.ok) return response;
      if (!shouldRetry(response.status) || attempt === retries) return response;
    } catch (error) {
      if (attempt === retries) throw error;
    } finally {
      clearTimeout(timeout);
    }
    const backoffMs = 250 * 2 ** attempt;
    await sleep(backoffMs);
  }
  throw new Error('Duffel request failed after retries.');
}

export class DuffelProvider extends BaseProvider {
  constructor({ apiKey, enabled }) {
    super('duffel');
    this.apiKey = String(apiKey || '').trim();
    this.enabled = Boolean(enabled);
  }

  isEnabled() {
    return this.enabled;
  }

  isConfigured() {
    return this.apiKey.length > 0;
  }

  async searchOffers({ originIata, destinationIata, departureDate, returnDate, adults = 1, cabinClass = 'economy' }) {
    if (!this.isEnabled() || !this.isConfigured()) return [];

    // Map internal cabin class values to Duffel API values
    const duffelCabin = CABIN_CLASS_MAP[String(cabinClass).toLowerCase()] || 'economy';

    const payload = {
      data: {
        slices: [
          {
            origin: originIata,
            destination: destinationIata,
            departure_date: departureDate,
            // Limit connections to keep response manageable and prices realistic
            max_connections: 2
          }
        ],
        passengers: Array.from({ length: Math.max(1, Number(adults) || 1) }, () => ({ type: 'adult' })),
        cabin_class: duffelCabin
      }
    };

    if (returnDate) {
      payload.data.slices.push({
        origin: destinationIata,
        destination: originIata,
        departure_date: returnDate,
        max_connections: 2
      });
    }

    // CRITICAL: ?return_offers=true makes Duffel embed offers in the response body.
    // Without this flag the response only contains the offer_request_id and offers
    // must be fetched via a separate polling request — this integration uses inline.
    const response = await fetchWithTimeoutRetry(
      'https://api.duffel.com/air/offer_requests?return_offers=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Duffel-Version': 'v2',
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Duffel request failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const json = await response.json();
    const rawOffers = Array.isArray(json?.data?.offers) ? json.data.offers : [];

    // Sort cheapest first, then cap to MAX_OFFERS_PER_REQUEST to control processing cost.
    // Duffel can return 100+ offers per request; we only need the best few.
    const sorted = rawOffers
      .filter((o) => Number.isFinite(Number(o?.total_amount)) && Number(o.total_amount) > 0)
      .sort((a, b) => Number(a.total_amount) - Number(b.total_amount))
      .slice(0, MAX_OFFERS_PER_REQUEST);

    return sorted
      .map((offer) => {
        const slices = Array.isArray(offer?.slices) ? offer.slices : [];
        const outbound = slices[0] || null;
        const inbound = slices[1] || null;

        const outboundStops = Math.max(0, Number((outbound?.segments || []).length || 1) - 1);
        const inboundStops = inbound ? Math.max(0, Number((inbound?.segments || []).length || 1) - 1) : 0;
        const totalStops = outboundStops + inboundStops;

        const durationOutbound = parseIsoDurationMinutes(outbound?.duration);
        const durationInbound = parseIsoDurationMinutes(inbound?.duration);
        const totalDurationMinutes =
          (Number.isFinite(durationOutbound) ? durationOutbound : 0) +
          (Number.isFinite(durationInbound) ? durationInbound : 0);

        return this.normalizeOffer({
          originIata,
          destinationIata,
          departureDate,
          returnDate,
          currency: String(offer?.total_currency || offer?.base_currency || 'EUR').toUpperCase(),
          totalPrice: Number(offer?.total_amount),
          provider: 'duffel',
          cabinClass: duffelCabin,
          tripType: returnDate ? 'round_trip' : 'one_way',
          source: 'partner_feed',
          metadata: {
            offerId: offer?.id || null,
            offerRequestId: json?.data?.id || null,
            outboundStops,
            inboundStops,
            totalStops,
            durationMinutesOutbound: durationOutbound,
            durationMinutesInbound: durationInbound,
            totalDurationMinutes: Number.isFinite(totalDurationMinutes) && totalDurationMinutes > 0
              ? totalDurationMinutes
              : null
          }
        });
      })
      .filter((item) => Number.isFinite(item.totalPrice) && item.totalPrice > 0);
  }
}
