function toIso(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function toLower(value) {
  return String(value || '').trim().toLowerCase();
}

function toCountMap(items, keyResolver) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(keyResolver(item) || '').trim();
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function toTopItems(map, limit = 6, labelResolver = (key) => key) {
  return [...map.entries()]
    .map(([key, count]) => ({
      key,
      label: labelResolver(key),
      count: Number(count || 0)
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, Math.max(1, Number(limit) || 6));
}

function isLoginCompletedEvent(event) {
  const type = toLower(event?.type);
  const success = Boolean(event?.success);
  if (!success) return false;
  return type === 'login_success' || type === 'login_success_mfa' || type === 'register_success';
}

function isAuthFailureEvent(event) {
  const success = Boolean(event?.success);
  if (success) return false;
  const type = toLower(event?.type);
  return type.includes('login') || type.includes('register') || type.includes('refresh');
}

function toRouteKey(origin, destinationIata) {
  const from = String(origin || '').trim().toUpperCase();
  const to = String(destinationIata || '').trim().toUpperCase();
  if (!from || !to) return '';
  return `${from}-${to}`;
}

function parsePlanType(value) {
  const plan = toLower(value);
  if (plan === 'elite' || plan === 'creator') return 'elite';
  if (plan === 'pro') return 'pro';
  return 'free';
}

function isRecent(event, sinceMs) {
  const at = new Date(event?.at).getTime();
  return Number.isFinite(at) && at >= sinceMs;
}

function mapActivityEvent(event) {
  const eventType = toLower(event?.eventType);
  const action = toLower(event?.action);
  const source = String(event?.source || '').trim();
  const itineraryId = String(event?.itineraryId || '').trim();
  const routeSlug = String(event?.routeSlug || '').trim();
  const surface = String(event?.surface || '').trim();
  if (eventType === 'result_interaction_clicked' && action === 'track_route') {
    return {
      id: String(event?.id || ''),
      at: toIso(event?.at),
      type: 'route_tracked',
      label: `Route tracked: ${routeSlug || 'unknown route'}`,
      meta: surface ? `surface: ${surface}` : ''
    };
  }
  if (eventType === 'itinerary_opened') {
    return {
      id: String(event?.id || ''),
      at: toIso(event?.at),
      type: 'itinerary_opened',
      label: `Itinerary opened: ${itineraryId || 'unknown itinerary'}`,
      meta: surface ? `surface: ${surface}` : ''
    };
  }
  if (eventType === 'booking_clicked') {
    return {
      id: String(event?.id || ''),
      at: toIso(event?.at),
      type: 'booking_clicked',
      label: `Booking clicked: ${itineraryId || 'unknown itinerary'}`,
      meta: surface ? `surface: ${surface}` : ''
    };
  }
  if (eventType === 'upgrade_modal_opened' || eventType === 'elite_modal_opened') {
    return {
      id: String(event?.id || ''),
      at: toIso(event?.at),
      type: 'upgrade_opened',
      label: `Upgrade flow opened (${eventType === 'elite_modal_opened' ? 'ELITE' : 'PRO'})`,
      meta: source ? `source: ${source}` : ''
    };
  }
  if (eventType === 'upgrade_primary_cta_clicked') {
    return {
      id: String(event?.id || ''),
      at: toIso(event?.at),
      type: 'upgrade_confirmed',
      label: `Upgrade confirmed (${String(event?.planType || 'pro').toUpperCase()})`,
      meta: source ? `source: ${source}` : ''
    };
  }
  if (eventType === 'radar_activated') {
    return {
      id: String(event?.id || ''),
      at: toIso(event?.at),
      type: 'radar_activated',
      label: 'Radar activated',
      meta: source ? `source: ${source}` : ''
    };
  }
  return null;
}

function buildFunnelSteps({ loginCompleted, trackRouteClicked, itineraryOpened, bookingClicked }) {
  const ordered = [
    { key: 'login_completed', label: 'Login completed', count: loginCompleted },
    { key: 'track_route_clicked', label: 'Track route clicked', count: trackRouteClicked },
    { key: 'itinerary_opened', label: 'Itinerary opened', count: itineraryOpened },
    { key: 'booking_clicked', label: 'Booking clicked', count: bookingClicked }
  ];

  return ordered.map((step, index) => {
    if (index === 0) {
      return {
        ...step,
        conversionPct: 100,
        dropOffPct: 0
      };
    }
    const prev = ordered[index - 1];
    const prevCount = Number(prev.count || 0);
    const count = Number(step.count || 0);
    const conversionPct = prevCount > 0 ? Number(((count / prevCount) * 100).toFixed(1)) : 0;
    return {
      ...step,
      conversionPct,
      dropOffPct: Number((100 - conversionPct).toFixed(1))
    };
  });
}

export function buildAdminBackofficeReport({
  db,
  followSignals = { total: 0, topRoutes: [] },
  now = Date.now(),
  windowDays = 30
}) {
  const safeDb = db || {};
  const users = Array.isArray(safeDb.users) ? safeDb.users : [];
  const authEvents = Array.isArray(safeDb.authEvents) ? safeDb.authEvents : [];
  const outboundEvents = Array.isArray(safeDb.outboundClicks) ? safeDb.outboundClicks : [];
  const telemetryEvents = Array.isArray(safeDb.clientTelemetryEvents) ? safeDb.clientTelemetryEvents : [];

  const nowMs = Number(now) || Date.now();
  const sinceWindowMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const since24hMs = nowMs - 24 * 60 * 60 * 1000;
  const since7dMs = nowMs - 7 * 24 * 60 * 60 * 1000;

  const authWindow = authEvents.filter((event) => isRecent(event, sinceWindowMs));
  const telemetryWindow = telemetryEvents.filter((event) => isRecent(event, sinceWindowMs));
  const outboundWindow = outboundEvents.filter((event) => isRecent(event, sinceWindowMs));
  const outbound24h = outboundEvents.filter((event) => isRecent(event, since24hMs));

  const loginCompletedEvents = authWindow.filter(isLoginCompletedEvent);
  const active24h = new Set(
    authEvents
      .filter((event) => isRecent(event, since24hMs) && isLoginCompletedEvent(event))
      .map((event) => String(event?.userId || event?.emailHash || event?.email || '').trim())
      .filter(Boolean)
  ).size;
  const active7d = new Set(
    authEvents
      .filter((event) => isRecent(event, since7dMs) && isLoginCompletedEvent(event))
      .map((event) => String(event?.userId || event?.emailHash || event?.email || '').trim())
      .filter(Boolean)
  ).size;

  const trackRouteEvents = telemetryWindow.filter(
    (event) => toLower(event?.eventType) === 'result_interaction_clicked' && toLower(event?.action) === 'track_route'
  );
  const itineraryOpenedEvents = telemetryWindow.filter((event) => toLower(event?.eventType) === 'itinerary_opened');
  const bookingClickedEvents = outboundWindow.filter((event) => toLower(event?.eventName || 'booking_clicked') === 'booking_clicked');
  const upgradeClickEvents = telemetryWindow.filter((event) => {
    const eventType = toLower(event?.eventType);
    return eventType === 'upgrade_cta_clicked' || eventType === 'elite_cta_clicked';
  });
  const upgradePrimaryEvents = telemetryWindow.filter((event) => toLower(event?.eventType) === 'upgrade_primary_cta_clicked');

  const bookingRouteMap = toCountMap(bookingClickedEvents, (event) => toRouteKey(event?.origin, event?.destinationIata));
  const trackedRouteMap = toCountMap(trackRouteEvents, (event) => event?.routeSlug);
  const itineraryMap = toCountMap(itineraryOpenedEvents, (event) => event?.itineraryId);
  const upgradeSourceMap = toCountMap(
    telemetryWindow.filter((event) => toLower(event?.eventType).includes('upgrade') || toLower(event?.eventType).includes('elite')),
    (event) => event?.source
  );

  const planCountMap = toCountMap(users, (user) => parsePlanType(user?.planType || (user?.isPremium ? 'pro' : 'free')));

  const redirectFailures24h = outbound24h.filter((event) => toLower(event?.eventName) === 'outbound_redirect_failed');
  const authFailures24h = authEvents.filter((event) => isRecent(event, since24hMs) && isAuthFailureEvent(event));
  const rateLimitEvents24h =
    authFailures24h.filter((event) => toLower(event?.type).includes('limit')).length +
    redirectFailures24h.filter((event) => toLower(event?.errorCode).includes('limit')).length;

  const recentErrorItems = [
    ...authFailures24h.map((event) => ({
      id: String(event?.id || ''),
      at: toIso(event?.at),
      scope: 'auth',
      message: String(event?.type || 'auth_failure')
    })),
    ...redirectFailures24h.map((event) => ({
      id: String(event?.id || ''),
      at: toIso(event?.at),
      scope: 'outbound',
      message: String(event?.errorCode || event?.failureReason || 'outbound_redirect_failed')
    }))
  ]
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, 12);

  const recentActivity = telemetryWindow
    .map(mapActivityEvent)
    .filter(Boolean)
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, 20);

  const funnelSteps = buildFunnelSteps({
    loginCompleted: loginCompletedEvents.length,
    trackRouteClicked: trackRouteEvents.length,
    itineraryOpened: itineraryOpenedEvents.length,
    bookingClicked: bookingClickedEvents.length
  });

  const proInterestCount = upgradePrimaryEvents.filter((event) => parsePlanType(event?.planType) === 'pro').length;
  const eliteInterestCount = upgradePrimaryEvents.filter((event) => parsePlanType(event?.planType) === 'elite').length;

  return {
    generatedAt: new Date(nowMs).toISOString(),
    windowDays,
    overview: {
      totalUsers: users.length,
      loginSessions: loginCompletedEvents.length,
      activeUsers24h: active24h,
      activeUsers7d: active7d,
      trackedRouteActions: trackRouteEvents.length,
      trackedRoutesTotal: Number(followSignals?.total || 0),
      itineraryOpens: itineraryOpenedEvents.length,
      bookingClicks: bookingClickedEvents.length,
      upgradeClicks: upgradeClickEvents.length
    },
    funnel: {
      steps: funnelSteps
    },
    behavior: {
      topTrackedRoutes: toTopItems(trackedRouteMap, 8, (slug) => String(slug || 'Unknown route').replace(/[-_]+/g, ' ')),
      topViewedItineraries: toTopItems(itineraryMap, 8, (id) => id || 'Unknown itinerary'),
      topBookingRoutes: toTopItems(bookingRouteMap, 8, (route) => route),
      topUpgradeSurfaces: toTopItems(upgradeSourceMap, 8, (surface) => surface || 'unknown')
    },
    monetization: {
      upgradeClicked: upgradeClickEvents.length,
      planDistribution: toTopItems(planCountMap, 3, (plan) => String(plan || 'free').toUpperCase()),
      proInterestCount,
      eliteInterestCount,
      triggerSurfaces: toTopItems(upgradeSourceMap, 8, (surface) => surface || 'unknown')
    },
    operations: {
      authFailures24h: authFailures24h.length,
      outboundRedirectFailures24h: redirectFailures24h.length,
      rateLimitEvents24h,
      recentErrors: recentErrorItems
    },
    recentActivity
  };
}
