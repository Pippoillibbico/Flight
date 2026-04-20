export function createRuntimeAppContext({
  env,
  logger,
  scanProviderOverlapPolicy,
  flightScanEnabled,
  providerCollectionEnabled,
  createFlightProviderRegistry,
  createProviderRegistry,
  createLiveFlightService,
  createScanStatusService,
  buildBookingLink,
  outboundAllowedHostsEnv,
  evaluateStartupReadiness,
  getCacheClient
}) {
  const externalFlightPartnersEnabled = String(env.ENABLE_EXTERNAL_FLIGHT_PARTNERS || 'false').trim().toLowerCase() === 'true';
  const flightProviderRegistry = createFlightProviderRegistry({
    enableExternalPartners: externalFlightPartnersEnabled,
    outboundAllowedHostsEnv,
    resolveBookingUrl: ({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass }) =>
      buildBookingLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass })
  });

  const dataProviderRegistry = createProviderRegistry();
  const liveFlightService = createLiveFlightService({ providerRegistry: dataProviderRegistry, cacheClient: getCacheClient() });
  const scanStatusService = createScanStatusService({ providerRegistry: dataProviderRegistry });

  const providerCollectionEffectiveEnabled = !(scanProviderOverlapPolicy === 'flight_scan_wins' && flightScanEnabled && providerCollectionEnabled);
  if (providerCollectionEnabled && !providerCollectionEffectiveEnabled) {
    logger.warn(
      {
        overlapPolicy: scanProviderOverlapPolicy,
        flightScanEnabled: Boolean(flightScanEnabled),
        providerCollectionEnabled: Boolean(providerCollectionEnabled)
      },
      'provider_collection_disabled_due_to_overlap_policy'
    );
  }

  const startupReadiness = evaluateStartupReadiness();
  const runtimeConfigAudit = startupReadiness.runtimeAudit;

  return {
    externalFlightPartnersEnabled,
    flightProviderRegistry,
    dataProviderRegistry,
    liveFlightService,
    scanStatusService,
    providerCollectionEffectiveEnabled,
    startupReadiness,
    runtimeConfigAudit
  };
}
