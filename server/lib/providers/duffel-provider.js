import { BaseProvider } from './base-provider.js';

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

    const response = await fetch('https://api.duffel.com/air/offer_requests', {
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
      .map((offer) =>
        this.normalizeOffer({
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
          metadata: { offerId: offer?.id || null }
        })
      )
      .filter((item) => Number.isFinite(item.totalPrice) && item.totalPrice > 0);
  }
}
