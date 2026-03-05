/**
 * @typedef {Object} OutboundResolvePayload
 * @property {string} partner
 * @property {string} origin
 * @property {string} destinationIata
 * @property {string} dateFrom
 * @property {string} dateTo
 * @property {number} travellers
 * @property {string} cabinClass
 * @property {string=} utmSource
 * @property {string=} utmMedium
 * @property {string=} utmCampaign
 */

/**
 * @typedef {Object} FlightProviderRegistryOptions
 * @property {boolean=} enableExternalPartners
 * @property {(params: Omit<OutboundResolvePayload, 'partner'>) => string} resolveBookingUrl
 * @property {string=} outboundAllowedHostsEnv
 */

/**
 * Creates a runtime provider registry.
 * Default mode is local/proprietary only (`tde_booking`).
 * External partners are opt-in via `enableExternalPartners`.
 * @param {FlightProviderRegistryOptions} options
 */
export function createFlightProviderRegistry(options) {
  const enableExternalPartners = Boolean(options?.enableExternalPartners);
  if (typeof options?.resolveBookingUrl !== 'function') {
    throw new Error('resolveBookingUrl function is required.');
  }

  const providers = {
    tde_booking: {
      resolve: (payload) =>
        options.resolveBookingUrl({
          origin: String(payload.origin || '').toUpperCase(),
          destinationIata: String(payload.destinationIata || '').toUpperCase(),
          dateFrom: payload.dateFrom,
          dateTo: payload.dateTo,
          travellers: payload.travellers,
          cabinClass: String(payload.cabinClass || 'economy').toLowerCase()
        })
    }
  };

  if (enableExternalPartners) {
    // External providers intentionally disabled in proprietary local mode.
  }

  const defaultHosts = ['booking.travel-decision-engine.com'];
  const envHosts = String(options?.outboundAllowedHostsEnv || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowedHosts = new Set([...defaultHosts, ...envHosts]);

  return {
    allowedPartners: Object.keys(providers),
    allowedHosts,
    ensureAllowedUrl(rawUrl) {
      const candidate = new URL(rawUrl);
      const host = candidate.hostname.toLowerCase();
      if (!allowedHosts.has(host)) throw new Error('Outbound host is not allowlisted.');
      return candidate.toString();
    },
    resolveOutboundPartnerUrl(payload) {
      const provider = providers[String(payload?.partner || 'tde_booking')];
      if (!provider) throw new Error('Unsupported outbound partner.');
      return this.ensureAllowedUrl(provider.resolve(payload));
    }
  };
}
