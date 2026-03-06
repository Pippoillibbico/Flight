import { BaseProvider } from './base-provider.js';

export class AmadeusProvider extends BaseProvider {
  constructor({ clientId, clientSecret, enabled }) {
    super('amadeus');
    this.clientId = String(clientId || '').trim();
    this.clientSecret = String(clientSecret || '').trim();
    this.enabled = Boolean(enabled);
  }

  isEnabled() {
    return this.enabled;
  }

  isConfigured() {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  async searchOffers({ originIata, destinationIata, departureDate, returnDate, cabinClass = 'economy' }) {
    if (!this.isEnabled() || !this.isConfigured()) return [];
    // Enterprise-ready adapter stub: safe no-op until credentials + contract are fully enabled.
    return [
      this.normalizeOffer({
        originIata,
        destinationIata,
        departureDate,
        returnDate,
        currency: 'EUR',
        totalPrice: NaN,
        provider: 'amadeus',
        cabinClass,
        tripType: returnDate ? 'round_trip' : 'one_way',
        source: 'partner_feed',
        metadata: { stub: true }
      })
    ].filter((item) => Number.isFinite(item.totalPrice) && item.totalPrice > 0);
  }
}
