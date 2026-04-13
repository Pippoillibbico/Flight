import { BaseProvider } from './base-provider.js';

const DEFAULT_TIMEOUT_MS = Math.max(3000, Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS || 12000));
const DEFAULT_RETRIES = Math.max(0, Math.min(4, Number(process.env.PROVIDER_REQUEST_RETRIES || 2)));

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
    const payload = {
      data: {
        slices: [
          {
            origin: originIata,
            destination: destinationIata,
            departure_date: departureDate
          }
        ],
        passengers: Array.from({ length: Math.max(1, Number(adults) || 1) }, () => ({ type: 'adult' })),
        cabin_class: cabinClass
      }
    };
    if (returnDate) {
      payload.data.slices.push({
        origin: destinationIata,
        destination: originIata,
        departure_date: returnDate
      });
    }

    const response = await fetchWithTimeoutRetry('https://api.duffel.com/air/offer_requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Duffel-Version': 'v2',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Duffel request failed (${response.status}).`);
    const json = await response.json();
    const offers = Array.isArray(json?.data?.offers) ? json.data.offers : [];
    return offers
      .map((offer) => {
        const slices = Array.isArray(offer?.slices) ? offer.slices : [];
        const outbound = slices[0] || null;
        const inbound = slices[1] || null;
        const outboundStops = Math.max(0, Number((outbound?.segments || []).length || 1) - 1);
        const inboundStops = inbound ? Math.max(0, Number((inbound?.segments || []).length || 1) - 1) : 0;
        const durationOutbound = parseIsoDurationMinutes(outbound?.duration);
        const durationInbound = parseIsoDurationMinutes(inbound?.duration);
        const totalDurationMinutes =
          (Number.isFinite(durationOutbound) ? durationOutbound : 0) +
          (Number.isFinite(durationInbound) ? durationInbound : 0);
        const totalStops = outboundStops + inboundStops;
        return this.normalizeOffer({
          originIata,
          destinationIata,
          departureDate,
          returnDate,
          currency: offer?.total_currency || offer?.base_currency || 'EUR',
          totalPrice: Number(offer?.total_amount || offer?.total || 0),
          provider: 'duffel',
          cabinClass,
          tripType: returnDate ? 'round_trip' : 'one_way',
          source: 'partner_feed',
          metadata: {
            offerId: offer?.id || null,
            outboundStops,
            inboundStops,
            totalStops,
            durationMinutesOutbound: durationOutbound,
            durationMinutesInbound: durationInbound,
            totalDurationMinutes: Number.isFinite(totalDurationMinutes) && totalDurationMinutes > 0 ? totalDurationMinutes : null
          }
        });
      })
      .filter((item) => Number.isFinite(item.totalPrice) && item.totalPrice > 0);
  }
}
