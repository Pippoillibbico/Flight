export class BaseProvider {
  constructor(name) {
    this.name = name;
  }

  isEnabled() {
    return false;
  }

  isConfigured() {
    return false;
  }

  async searchOffers() {
    return [];
  }

  normalizeOffer(input) {
    return {
      originIata: String(input.originIata || '').trim().toUpperCase(),
      destinationIata: String(input.destinationIata || '').trim().toUpperCase(),
      departureDate: String(input.departureDate || '').slice(0, 10),
      returnDate: input.returnDate ? String(input.returnDate).slice(0, 10) : null,
      currency: String(input.currency || 'EUR').trim().toUpperCase(),
      totalPrice: Number(input.totalPrice),
      provider: String(input.provider || this.name || 'provider').trim(),
      cabinClass: String(input.cabinClass || 'economy').trim().toLowerCase(),
      tripType: String(input.tripType || (input.returnDate ? 'round_trip' : 'one_way')).trim().toLowerCase(),
      observedAt: input.observedAt ? new Date(input.observedAt).toISOString() : new Date().toISOString(),
      source: String(input.source || 'partner_feed').trim().toLowerCase(),
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
    };
  }
}
