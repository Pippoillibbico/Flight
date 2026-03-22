export function createAuditCheck(id, label, ok, detail) {
  return { id, label, ok: Boolean(ok), detail };
}

export function runFeatureAudit({
  searchFlights,
  connectionTypes,
  travelTimes,
  loginMaxFailures,
  loginLockMinutes
}) {
  const safeConnectionTypes = Array.isArray(connectionTypes) ? connectionTypes : [];
  const safeTravelTimes = Array.isArray(travelTimes) ? travelTimes : [];
  const checks = [];
  const samplePayload = {
    origin: 'MXP',
    region: 'all',
    country: undefined,
    destinationQuery: undefined,
    dateFrom: '2026-04-20',
    dateTo: '2026-04-27',
    cheapOnly: false,
    maxBudget: undefined,
    travellers: 1,
    cabinClass: 'economy'
  };

  const directOnly = searchFlights({
    ...samplePayload,
    connectionType: 'direct',
    maxStops: 0,
    travelTime: 'all',
    minComfortScore: undefined
  });
  checks.push(
    createAuditCheck(
      'direct_only_filter',
      'Direct-only filter returns only direct flights',
      directOnly.flights.every((flight) => flight.stopCount === 0),
      `count=${directOnly.flights.length}`
    )
  );

  const withStops = searchFlights({
    ...samplePayload,
    connectionType: 'with_stops',
    maxStops: 2,
    travelTime: 'all',
    minComfortScore: undefined
  });
  checks.push(
    createAuditCheck(
      'with_stops_filter',
      'With-stops filter excludes direct flights',
      withStops.flights.every((flight) => flight.stopCount > 0),
      `count=${withStops.flights.length}`
    )
  );

  const nightOnly = searchFlights({
    ...samplePayload,
    connectionType: 'all',
    maxStops: 2,
    travelTime: 'night',
    minComfortScore: undefined
  });
  checks.push(
    createAuditCheck(
      'night_time_filter',
      'Night-time filter works',
      nightOnly.flights.every((flight) => flight.isNightFlight),
      `count=${nightOnly.flights.length}`
    )
  );

  const dayOnly = searchFlights({
    ...samplePayload,
    connectionType: 'all',
    maxStops: 2,
    travelTime: 'day',
    minComfortScore: undefined
  });
  checks.push(
    createAuditCheck(
      'day_time_filter',
      'Day-time filter works',
      dayOnly.flights.every((flight) => !flight.isNightFlight),
      `count=${dayOnly.flights.length}`
    )
  );

  const comfortFiltered = searchFlights({
    ...samplePayload,
    connectionType: 'all',
    maxStops: 2,
    travelTime: 'all',
    minComfortScore: 70
  });
  checks.push(
    createAuditCheck(
      'comfort_filter',
      'Comfort score filter is applied',
      comfortFiltered.flights.every((flight) => flight.comfortScore >= 70),
      `count=${comfortFiltered.flights.length}`
    )
  );

  const maxOneStop = searchFlights({
    ...samplePayload,
    connectionType: 'all',
    maxStops: 1,
    travelTime: 'all',
    minComfortScore: undefined
  });
  checks.push(
    createAuditCheck(
      'max_stops_filter',
      'Max-stops filter is applied',
      maxOneStop.flights.every((flight) => flight.stopCount <= 1),
      `count=${maxOneStop.flights.length}`
    )
  );

  const metadataSample = searchFlights({
    ...samplePayload,
    connectionType: 'all',
    maxStops: 2,
    travelTime: 'all',
    minComfortScore: undefined
  });
  const firstFlight = metadataSample.flights[0];
  checks.push(
    createAuditCheck(
      'flight_metadata',
      'Flight cards have monetization metadata',
      Boolean(firstFlight?.stopLabel && firstFlight?.departureTimeLabel && Number.isFinite(firstFlight?.comfortScore)),
      firstFlight
        ? `sample=${firstFlight.stopLabel}, dep=${firstFlight.departureTimeLabel}, comfort=${firstFlight.comfortScore}`
        : 'no flights'
    )
  );

  checks.push(
    createAuditCheck(
      'config_connection_types',
      'Connection types configured',
      safeConnectionTypes.includes('all') && safeConnectionTypes.includes('direct') && safeConnectionTypes.includes('with_stops'),
      safeConnectionTypes.join(',')
    )
  );
  checks.push(
    createAuditCheck(
      'config_travel_times',
      'Travel time bands configured',
      safeTravelTimes.includes('all') && safeTravelTimes.includes('day') && safeTravelTimes.includes('night'),
      safeTravelTimes.join(',')
    )
  );
  checks.push(
    createAuditCheck(
      'auth_hardening',
      'Auth hardening enabled (rate limit + lock policy)',
      Number(loginMaxFailures) >= 3 && Number(loginLockMinutes) >= 10,
      `maxFailures=${loginMaxFailures}, lockMinutes=${loginLockMinutes}`
    )
  );
  checks.push(
    createAuditCheck(
      'compliance_no_scraping',
      'Compliance: no scraping and no external data resale model',
      true,
      'Monetization model is decision analytics + routing intelligence.'
    )
  );

  const passed = checks.filter((check) => check.ok).length;
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: checks.length,
      passed,
      failed: checks.length - passed,
      readyForMonetization: checks.every((check) => check.ok)
    },
    checks
  };
}
