import { normalizePlanType } from './plans/normalize-plan-type.js';
import { TELEMETRY_EVENTS, resolveTelemetryEventType } from '../../src/shared/telemetry/events.js';

function toIso(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function toLower(value) {
  return String(value || '').trim().toLowerCase();
}

function sanitizeReportText(value, maxLength = 120) {
  const raw = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(10, Number(maxLength) || 120));
  if (!raw) return '';
  return raw
    .replace(/bearer\s+[a-z0-9._-]+/ig, 'bearer [redacted]')
    .replace(/(token|secret|password|cookie)=([^\s;,&]+)/ig, '$1=[redacted]');
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

function parseRouteSlug(routeSlug) {
  const text = String(routeSlug || '').trim().toUpperCase();
  const match = text.match(/^([A-Z]{3})[-_ ]([A-Z]{3})$/);
  if (!match) return null;
  return { origin: match[1], destinationIata: match[2] };
}

function bookingEventFingerprint(event) {
  const atRaw = String(event?.at || event?.clickedAt || event?.createdAt || '').trim();
  const at = atRaw || 'no_ts';
  return [
    String(event?.userId || ''),
    String(event?.sessionId || ''),
    String(event?.itineraryId || event?.dealId || event?.correlationId || ''),
    String(event?.origin || ''),
    String(event?.destinationIata || ''),
    String(event?.surface || ''),
    at
  ].join('|');
}

function mergeBookingClickedEvents(outboundEvents, telemetryEvents) {
  const normalizedOutbound = (Array.isArray(outboundEvents) ? outboundEvents : [])
    .filter((event) => resolveTelemetryEventType(event?.eventName || TELEMETRY_EVENTS.BOOKING_CLICKED) === TELEMETRY_EVENTS.BOOKING_CLICKED)
    .map((event) => ({
      at: event?.at || event?.clickedAt || event?.createdAt || null,
      userId: event?.userId || null,
      sessionId: event?.sessionId || null,
      itineraryId: event?.itineraryId || null,
      dealId: event?.dealId || event?.clickId || null,
      correlationId: event?.correlationId || null,
      origin: event?.origin || null,
      destinationIata: event?.destinationIata || null,
      surface: event?.surface || null
    }));

  const normalizedTelemetry = (Array.isArray(telemetryEvents) ? telemetryEvents : [])
    .filter((event) => {
      const type = resolveTelemetryEventType(event?.eventType);
      return type === TELEMETRY_EVENTS.BOOKING_CLICKED;
    })
    .map((event) => {
      const parsedRoute = parseRouteSlug(event?.routeSlug);
      return {
        at: event?.at || null,
        userId: event?.userId || null,
        sessionId: event?.sessionId || null,
        itineraryId: event?.itineraryId || null,
        dealId: event?.dealId || null,
        correlationId: event?.correlationId || null,
        origin: parsedRoute?.origin || null,
        destinationIata: parsedRoute?.destinationIata || null,
        surface: event?.surface || null
      };
    });

  const deduped = [];
  const seen = new Set();
  for (const item of [...normalizedOutbound, ...normalizedTelemetry]) {
    const key = bookingEventFingerprint(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function parsePlanType(value) {
  return normalizePlanType(value);
}

function isRecent(event, sinceMs) {
  const at = new Date(event?.at).getTime();
  return Number.isFinite(at) && at >= sinceMs;
}

function mapActivityEvent(event) {
  const eventType = resolveTelemetryEventType(event?.eventType);
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
  if (eventType === TELEMETRY_EVENTS.BOOKING_CLICKED) {
    return {
      id: String(event?.id || ''),
      at: toIso(event?.at),
      type: TELEMETRY_EVENTS.BOOKING_CLICKED,
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
  windowDays = 30,
  costMonitoring = null
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
  const bookingClickedEvents = mergeBookingClickedEvents(outboundWindow, telemetryWindow);
  const upgradeClickEvents = telemetryWindow.filter((event) => {
    const eventType = toLower(event?.eventType);
    return eventType === 'upgrade_cta_clicked' || eventType === 'elite_cta_clicked';
  });
  const upgradePrimaryEvents = telemetryWindow.filter((event) => toLower(event?.eventType) === 'upgrade_primary_cta_clicked');

  const bookingRouteMap = toCountMap(bookingClickedEvents, (event) => toRouteKey(event?.origin, event?.destinationIata));
  const trackedRouteMap = toCountMap(trackRouteEvents, (event) => event?.routeSlug);
  const itineraryMap = toCountMap(itineraryOpenedEvents, (event) => event?.itineraryId);
  const upgradeSourceMap = toCountMap(
    telemetryWindow.filter(
      (event) => toLower(event?.eventType).includes('upgrade') || toLower(event?.eventType).includes('elite')
    ),
    (event) => event?.source
  );

  const planCountMap = toCountMap(users, (user) => parsePlanType(user?.planType || (user?.isPremium ? 'pro' : 'free')));

  const redirectFailures24h = outbound24h.filter(
    (event) => resolveTelemetryEventType(event?.eventName) === TELEMETRY_EVENTS.OUTBOUND_REDIRECT_FAILED
  );
  const authFailures24h = authEvents.filter((event) => isRecent(event, since24hMs) && isAuthFailureEvent(event));
  const rateLimitEvents24h =
    authFailures24h.filter((event) => toLower(event?.type).includes('limit')).length +
    redirectFailures24h.filter((event) => toLower(event?.errorCode).includes('limit')).length;

  const recentErrorItems = [
    ...authFailures24h.map((event) => ({
      id: String(event?.id || ''),
      at: toIso(event?.at),
      scope: 'auth',
      message: sanitizeReportText(event?.type || 'auth_failure')
    })),
    ...redirectFailures24h.map((event) => ({
      id: String(event?.id || ''),
      at: toIso(event?.at),
      scope: 'outbound',
      message: sanitizeReportText(event?.errorCode || event?.failureReason || 'outbound_redirect_failed')
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
  const creatorInterestCount = upgradePrimaryEvents.filter((event) => parsePlanType(event?.planType) === 'creator').length;

  // Upgrade conversion funnel: shown → clicked → checkout_started → checkout_completed
  const ctaShownEvents = telemetryWindow.filter((event) => toLower(event?.eventType) === 'upgrade_cta_shown');
  const ctaClickedEvents = telemetryWindow.filter((event) =>
    toLower(event?.eventType) === 'upgrade_cta_clicked' || toLower(event?.eventType) === 'upgrade_primary_cta_clicked'
  );
  const checkoutStartedEvents = telemetryWindow.filter((event) => toLower(event?.eventType) === 'checkout_started');
  const checkoutCompletedEvents = telemetryWindow.filter((event) => toLower(event?.eventType) === 'checkout_completed');

  const ctaShownCount = ctaShownEvents.length;
  const ctaClickedCount = ctaClickedEvents.length;
  const checkoutStartedCount = checkoutStartedEvents.length;
  const checkoutCompletedCount = checkoutCompletedEvents.length;

  const conversionFunnel = [
    { step: 'upgrade_cta_shown', count: ctaShownCount, conversionPct: 100 },
    {
      step: 'upgrade_cta_clicked',
      count: ctaClickedCount,
      conversionPct: ctaShownCount > 0 ? Math.round((ctaClickedCount / ctaShownCount) * 1000) / 10 : null
    },
    {
      step: 'checkout_started',
      count: checkoutStartedCount,
      conversionPct: ctaClickedCount > 0 ? Math.round((checkoutStartedCount / ctaClickedCount) * 1000) / 10 : null
    },
    {
      step: 'checkout_completed',
      count: checkoutCompletedCount,
      conversionPct: checkoutStartedCount > 0 ? Math.round((checkoutCompletedCount / checkoutStartedCount) * 1000) / 10 : null
    }
  ];

  // Trial funnel: trial_started (= registration) → trial_banner_shown → trial_upgrade_clicked → checkout_completed
  const trialStartedCount = users.filter((u) => u?.trialEndsAt).length;
  const trialBannerShownCount = telemetryWindow.filter((event) => toLower(event?.eventType) === 'trial_banner_shown').length;
  const trialUpgradeClickedCount = telemetryWindow.filter((event) => toLower(event?.eventType) === 'trial_upgrade_clicked').length;
  const monitoring = costMonitoring && typeof costMonitoring === 'object'
    ? {
        callsPerUser: costMonitoring.callsPerUser || null,
        costPerUser: costMonitoring.costPerUser || null,
        budgetUsedPercent: {
          providerDailyCalls: Number(costMonitoring?.provider?.budgetUsedPercent || 0),
          aiMonthlyTokens: Number(costMonitoring?.ai?.budgetUsedPercent || 0)
        },
        search429Count: Number(costMonitoring?.search?.throttled429 || 0),
        search429Pct: (() => {
          const totalSearch = Number(costMonitoring?.search?.total || 0);
          const blocked = Number(costMonitoring?.search?.throttled429 || 0);
          const denominator = totalSearch + blocked;
          if (!Number.isFinite(denominator) || denominator <= 0) return 0;
          return Math.round((blocked / denominator) * 1000) / 10;
        })(),
        usersActiveEstimated: Number(costMonitoring?.search?.activeUsers || 0),
        feedViews: Number(costMonitoring?.monetization?.feedViews || 0),
        redirectClicks: Number(costMonitoring?.monetization?.redirectClicks || 0),
        ctrPercent: Number(costMonitoring?.monetization?.ctrPercent || 0),
        providerCostTotalEur: Number(costMonitoring?.costs?.providerCostEur || 0),
        aiCostTotalEur: Number(costMonitoring?.costs?.aiCostEur || 0),
        providerBudgetExceededEvents: Number(costMonitoring?.provider?.budgetExceededEvents || 0),
        aiBudgetExceededEvents: Number(costMonitoring?.ai?.budgetExceededEvents || 0),
        alerts: Array.isArray(costMonitoring?.alerts) ? costMonitoring.alerts : [],
        suggestions: Array.isArray(costMonitoring?.suggestions) ? costMonitoring.suggestions : []
      }
    : null;

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
      creatorInterestCount,
      eliteInterestCount: creatorInterestCount,
      triggerSurfaces: toTopItems(upgradeSourceMap, 8, (surface) => surface || 'unknown'),
      conversionFunnel,
      trial: {
        usersInTrial: trialStartedCount,
        bannerShown: trialBannerShownCount,
        upgradeClicked: trialUpgradeClickedCount,
        conversionPct: trialStartedCount > 0 ? Math.round((checkoutCompletedEvents.filter((e) => e?.source === 'trial_banner').length / trialStartedCount) * 1000) / 10 : null
      }
    },
    operations: {
      authFailures24h: authFailures24h.length,
      outboundRedirectFailures24h: redirectFailures24h.length,
      rateLimitEvents24h,
      recentErrors: recentErrorItems
    },
    recentActivity,
    monitoring
  };
}
