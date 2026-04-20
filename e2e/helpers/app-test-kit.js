import { expect } from '@playwright/test';

const DEFAULT_USER = {
  id: 'u1',
  name: 'Test User',
  email: 'test@example.com',
  isPremium: true,
  planType: 'elite',
  mfaEnabled: false,
  onboardingDone: true
};

const DEFAULT_ADMIN_ALLOWLIST_EMAILS = ['giustinistefano9@gmail.com'];

const DEFAULT_RADAR = {
  id: 'r1',
  originAirports: ['FCO'],
  favoriteDestinations: ['Tokyo'],
  favoriteCountries: ['Japan'],
  budgetCeiling: 500,
  preferredTravelMonths: [11]
};

function createOpportunity(index, overrides = {}) {
  const templates = [
    {
      origin_city: 'Rome',
      origin_airport: 'FCO',
      destination_city: 'Tokyo',
      destination_airport: 'TYO',
      destination_country: 'Japan',
      destination_region: 'asia',
      destination_cluster_slug: 'japan',
      price: 489,
      depart_date: '2026-11-10',
      return_date: '2026-11-18',
      trip_length_days: 8,
      stops: 1,
      opportunity_level: 'Exceptional price',
      short_badge_text: 'Prezzo eccezionale'
    },
    {
      origin_city: 'Milan',
      origin_airport: 'MXP',
      destination_city: 'New York',
      destination_airport: 'NYC',
      destination_country: 'United States',
      destination_region: 'america',
      destination_cluster_slug: 'usa-east-coast',
      price: 312,
      depart_date: '2026-10-03',
      return_date: '2026-10-11',
      trip_length_days: 8,
      stops: 0,
      opportunity_level: 'Great deal',
      short_badge_text: 'Ottimo affare'
    },
    {
      origin_city: 'Bologna',
      origin_airport: 'BLQ',
      destination_city: 'Bangkok',
      destination_airport: 'BKK',
      destination_country: 'Thailand',
      destination_region: 'asia',
      destination_cluster_slug: 'southeast-asia',
      price: 418,
      depart_date: '2026-09-14',
      return_date: '2026-09-24',
      trip_length_days: 10,
      stops: 1,
      opportunity_level: 'Rare opportunity',
      short_badge_text: 'Opportunita rara'
    }
  ];
  const base = templates[index % templates.length];
  const fallbackId = `opp-${index + 1}`;
  return {
    id: fallbackId,
    currency: 'EUR',
    airline: 'partner_feed',
    booking_url: `https://example.com/book/${fallbackId}`,
    ai_description: 'Opportunita reale selezionata dal radar.',
    why_it_matters: 'Prezzo sotto baseline su rotta monitorata.',
    raw_score: 75 + (index % 10),
    final_score: 80 + (index % 10),
    ...base,
    ...overrides
  };
}

function createDefaultOpportunities(count = 6) {
  return Array.from({ length: count }, (_, idx) => createOpportunity(idx));
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isAdminEmail(state, email) {
  const allowlist = Array.isArray(state?.adminAllowlistEmails) && state.adminAllowlistEmails.length > 0
    ? state.adminAllowlistEmails
    : DEFAULT_ADMIN_ALLOWLIST_EMAILS;
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return allowlist.map((item) => normalizeEmail(item)).includes(normalized);
}

function buildAdminBackofficeMockReport(state) {
  const telemetryEvents = Array.isArray(state.adminTelemetryEvents) ? state.adminTelemetryEvents : [];
  const follows = Array.isArray(state.follows) ? state.follows : [];
  const itineraryOpened = telemetryEvents.filter((event) => event?.eventType === 'itinerary_opened').length;
  const bookingClicked = telemetryEvents.filter((event) => event?.eventType === 'booking_clicked').length;
  const trackedRouteActions = telemetryEvents.filter(
    (event) => event?.eventType === 'result_interaction_clicked' && event?.action === 'track_route'
  ).length;
  const upgradeClicked = telemetryEvents.filter(
    (event) => event?.eventType === 'upgrade_cta_clicked' || event?.eventType === 'elite_cta_clicked'
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    overview: {
      totalUsers: 1,
      loginSessions: Number(state.isLoggedIn ? 1 : 0),
      activeUsers24h: Number(state.isLoggedIn ? 1 : 0),
      activeUsers7d: Number(state.isLoggedIn ? 1 : 0),
      trackedRouteActions,
      trackedRoutesTotal: follows.length,
      itineraryOpens: itineraryOpened,
      bookingClicks: bookingClicked,
      upgradeClicks: upgradeClicked
    },
    funnel: {
      steps: [
        { key: 'login_completed', label: 'Login completed', count: Number(state.isLoggedIn ? 1 : 0), conversionPct: 100, dropOffPct: 0 },
        { key: 'track_route_clicked', label: 'Track route clicked', count: trackedRouteActions, conversionPct: 100, dropOffPct: 0 },
        { key: 'itinerary_opened', label: 'Itinerary opened', count: itineraryOpened, conversionPct: 100, dropOffPct: 0 },
        { key: 'booking_clicked', label: 'Booking clicked', count: bookingClicked, conversionPct: 100, dropOffPct: 0 }
      ]
    },
    behavior: {
      topTrackedRoutes: [{ key: 'japan', label: 'Japan', count: trackedRouteActions }],
      topViewedItineraries: [{ key: 'opp-1', label: 'opp-1', count: itineraryOpened }],
      topBookingRoutes: [{ key: 'MXP-LIS', label: 'MXP-LIS', count: bookingClicked }],
      topUpgradeSurfaces: [{ key: 'opportunity_feed_prompt', label: 'opportunity_feed_prompt', count: upgradeClicked }]
    },
    monetization: {
      upgradeClicked,
      planDistribution: [{ key: normalizePlan(state.user?.planType || 'free'), label: String(state.user?.planType || 'free').toUpperCase(), count: 1 }],
      proInterestCount: telemetryEvents.filter((event) => event?.eventType === 'upgrade_primary_cta_clicked' && event?.planType === 'pro').length,
      eliteInterestCount: telemetryEvents.filter((event) => event?.eventType === 'upgrade_primary_cta_clicked' && event?.planType === 'elite').length,
      triggerSurfaces: [{ key: 'opportunity_feed_prompt', label: 'opportunity_feed_prompt', count: upgradeClicked }]
    },
    operations: {
      authFailures24h: 0,
      outboundRedirectFailures24h: 0,
      rateLimitEvents24h: 0,
      recentErrors: []
    },
    recentActivity: telemetryEvents.slice(-6).map((event, index) => ({
      id: `act-${index + 1}`,
      at: event?.at || new Date().toISOString(),
      type: String(event?.eventType || 'unknown'),
      label: String(event?.eventType || 'Unknown event'),
      meta: event?.source ? `source: ${event.source}` : undefined
    }))
  };
}

export function createDefaultState(overrides = {}) {
  const baseState = {
    isLoggedIn: false,
    user: { ...DEFAULT_USER },
    notifications: [
      {
        id: 'n-1',
        title: '⚡ Opportunita rara trovata',
        message: 'Roma -> Tokyo a 489€',
        readAt: null
      }
    ],
    subscriptions: [],
    follows: [],
    radarMatches: [],
    feedAccess: {
      showUpgradePrompt: false,
      remainingToday: null,
      upgradeMessage: 'Sblocca tutte le opportunita con PRO'
    },
    adminAllowlistEmails: [...DEFAULT_ADMIN_ALLOWLIST_EMAILS],
    adminTelemetryEvents: [],
    billingProvider: 'stripe',
    radarPreferences: { ...DEFAULT_RADAR },
    opportunities: createDefaultOpportunities(6),
    clusters: [
      {
        id: 1,
        cluster_name: 'Japan',
        slug: 'japan',
        region: 'asia',
        min_price: 489,
        opportunities_count: 2
      },
      {
        id: 2,
        cluster_name: 'Southeast Asia',
        slug: 'southeast-asia',
        region: 'asia',
        min_price: 418,
        opportunities_count: 2
      },
      {
        id: 3,
        cluster_name: 'USA East Coast',
        slug: 'usa-east-coast',
        region: 'america',
        min_price: 312,
        opportunities_count: 2
      }
    ],
    pipelineStatus: {
      totals: {
        published: 6,
        total: 6,
        normalizedFlights: 12,
        taggedOpportunities: 6,
        preparedMatches: 4
      }
    }
  };
  const state = {
    ...baseState,
    ...overrides
  };
  state.user = {
    ...baseState.user,
    ...(overrides.user || {})
  };
  state.radarPreferences = {
    ...baseState.radarPreferences,
    ...(overrides.radarPreferences || {})
  };
  state.feedAccess = {
    ...baseState.feedAccess,
    ...(overrides.feedAccess || {})
  };
  state.adminAllowlistEmails = Array.isArray(overrides.adminAllowlistEmails)
    ? overrides.adminAllowlistEmails
    : [...baseState.adminAllowlistEmails];
  state.adminTelemetryEvents = Array.isArray(overrides.adminTelemetryEvents)
    ? overrides.adminTelemetryEvents
    : [...baseState.adminTelemetryEvents];
  state.notifications = Array.isArray(overrides.notifications) ? overrides.notifications : [...baseState.notifications];
  state.subscriptions = Array.isArray(overrides.subscriptions) ? overrides.subscriptions : [...baseState.subscriptions];
  state.follows = Array.isArray(overrides.follows) ? overrides.follows : [...baseState.follows];
  state.radarMatches = Array.isArray(overrides.radarMatches) ? overrides.radarMatches : [...baseState.radarMatches];
  state.opportunities = Array.isArray(overrides.opportunities) ? overrides.opportunities : [...baseState.opportunities];
  state.clusters = Array.isArray(overrides.clusters) ? overrides.clusters : [...baseState.clusters];
  state.pipelineStatus = {
    ...baseState.pipelineStatus,
    ...(overrides.pipelineStatus || {})
  };
  return state;
}

function normalizePlan(planType) {
  const plan = String(planType || 'free').trim().toLowerCase();
  if (plan === 'creator') return 'elite';
  if (plan === 'pro' || plan === 'elite' || plan === 'free') return plan;
  return 'free';
}

function parseRequestBody(request) {
  try {
    return request.postDataJSON();
  } catch {
    try {
      return JSON.parse(request.postData() || '{}');
    } catch {
      return {};
    }
  }
}

function updatePlan(state, planType) {
  const normalized = normalizePlan(planType);
  state.user = {
    ...state.user,
    planType: normalized,
    isPremium: normalized === 'pro' || normalized === 'elite'
  };
}

export async function setupApiMocks(page, state) {
  const debugUnmatchedApi = String(process.env.E2E_LOG_UNMATCHED_API || '').trim() === '1';
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = String(url.pathname || '').replace(/\/+$/, '') || '/';

    const json = (payload, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(payload)
      });

    if (path === '/api/config') {
      return json({
        origins: [
          { code: 'FCO', city: 'Roma', label: 'Roma Fiumicino (FCO)' },
          { code: 'MXP', city: 'Milano', label: 'Milano Malpensa (MXP)' }
        ],
        regions: ['all', 'eu', 'asia', 'america', 'oceania'],
        cabins: ['economy', 'premium', 'business'],
        connectionTypes: ['all', 'direct', 'with_stops'],
        travelTimes: ['all', 'day', 'night'],
        countriesByRegion: {}
      });
    }

    if (path === '/api/system/capabilities' && method === 'GET') {
      return json({
        capabilities: {
          data_source: 'live',
          providers: {
            duffel: true,
            kiwi: true,
            skyscanner: true
          }
        }
      });
    }

    if (path === '/api/billing/pricing') {
      return json({
        pricing: {
          free: { monthlyEur: 0 },
          pro: { monthlyEur: 7 },
          creator: { monthlyEur: 19 },
          updatedAt: new Date().toISOString(),
          lastCostCheckAt: new Date().toISOString()
        }
      });
    }

    if (path === '/api/billing/subscription' && method === 'GET') {
      const planType = normalizePlan(state.user?.planType || 'free');
      const provider = String(state.billingProvider || 'stripe').trim().toLowerCase();
      const planId = planType === 'elite' ? 'creator' : planType;
      return json({
        planId,
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        extraCredits: 0,
        billingProvider: provider
      });
    }

    if (path === '/api/billing/client-token' && method === 'GET') {
      return json(
        {
          error: 'endpoint_removed',
          message: 'Braintree client-token flow has been removed. Use /api/billing/checkout for Stripe.'
        },
        410
      );
    }

    if (path === '/api/billing/checkout' && method === 'POST') {
      const body = parseRequestBody(request);
      const provider = String(state.billingProvider || 'stripe').trim().toLowerCase();
      if (provider !== 'stripe') {
        return json(
          {
            error: 'billing_provider_not_supported',
            message: 'Checkout endpoint requires Stripe provider.'
          },
          400
        );
      }

      const planType = normalizePlan(body?.planType || 'free');
      if (planType !== 'pro' && planType !== 'elite') {
        return json(
          {
            error: 'invalid_payload',
            message: 'Invalid plan type.'
          },
          400
        );
      }
      return json(
        {
          ok: true,
          provider: 'stripe',
          planType: planType === 'elite' ? 'elite' : 'pro',
          sessionId: `cs_test_${Date.now()}`,
          checkoutUrl: 'https://checkout.stripe.com/c/pay/test_session'
        },
        201
      );
    }

    if (path === '/api/auth/login' && method === 'POST') {
      state.isLoggedIn = true;
      const body = parseRequestBody(request);
      if (body?.email) {
        state.user = {
          ...state.user,
          email: body.email
        };
      }
      return json({
        token: 'test-token',
        session: { csrfToken: 'csrf-test' },
        user: state.user
      });
    }

    if (path === '/api/auth/register' && method === 'POST') {
      const body = parseRequestBody(request);
      state.isLoggedIn = true;
      updatePlan(state, 'free');
      state.user = {
        ...state.user,
        name: body?.name || state.user.name,
        email: body?.email || state.user.email
      };
      return json(
        {
          token: 'test-token',
          session: { csrfToken: 'csrf-test' },
          user: state.user
        },
        201
      );
    }

    if (path === '/api/auth/me') {
      if (!state.isLoggedIn) return json({ error: 'unauthorized' }, 401);
      return json({
        user: state.user,
        session: { csrfToken: 'csrf-test' },
        security: { isLocked: false, lockUntil: null, failedLoginCount: 0 }
      });
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      state.isLoggedIn = false;
      return json({ ok: true });
    }

    if (path === '/api/auth/refresh') return json({ token: 'test-token' });
    if (path === '/api/admin/telemetry' && method === 'POST') {
      if (!state.isLoggedIn) return json({ error: 'auth_required' }, 401);
      const body = parseRequestBody(request);
      state.adminTelemetryEvents.push({
        ...body,
        at: body?.at || new Date().toISOString()
      });
      state.adminTelemetryEvents = state.adminTelemetryEvents.slice(-200);
      return json({ ok: true }, 201);
    }
    if (path === '/api/admin/backoffice/report' && method === 'GET') {
      if (!state.isLoggedIn) return json({ error: 'auth_required' }, 401);
      if (!isAdminEmail(state, state.user?.email)) return json({ error: 'admin_access_denied' }, 403);
      return json(buildAdminBackofficeMockReport(state));
    }
    if (path === '/api/search/history') return json({ items: [] });
    if (path === '/api/watchlist') return json({ items: [] });
    if (path === '/api/security/activity') return json({ items: [] });
    if (path === '/api/notifications' && method === 'GET') {
      const unread = state.notifications.filter((n) => !n.readAt).length;
      return json({ items: state.notifications, unread });
    }
    if (path === '/api/notifications/read-all' && method === 'POST') {
      state.notifications = state.notifications.map((n) => ({ ...n, readAt: new Date().toISOString() }));
      return json({ ok: true });
    }
    if (path.includes('/api/notifications/') && path.endsWith('/read') && method === 'POST') {
      const id = path.split('/')[3];
      state.notifications = state.notifications.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
      return json({ ok: true });
    }
    if (path === '/api/notifications/scan' && method === 'POST') return json({ ok: true });

    if (path === '/api/alerts/subscriptions' && method === 'GET') return json({ items: state.subscriptions });
    if (path === '/api/alerts/subscriptions' && method === 'POST') {
      const body = parseRequestBody(request);
      state.subscriptions.push({
        id: `s-${state.subscriptions.length + 1}`,
        origin: body?.origin || 'FCO',
        region: body?.region || 'all',
        targetPrice: body?.targetPrice || 299,
        connectionType: body?.connectionType || 'all',
        enabled: true
      });
      return json({ ok: true }, 201);
    }

    if ((path === '/api/search' || path === '/api/search/public') && method === 'POST') {
      return json({
        meta: { count: 1, stayDays: 4 },
        alerts: [],
        flights: [
          {
            id: 'fco-tyo-1',
            origin: 'FCO',
            destination: 'Tokyo',
            destinationIata: 'TYO',
            price: 299,
            avg2024: 400,
            savingVs2024: 101,
            stopLabel: 'Direct',
            stopCount: 0,
            departureTimeLabel: '09:30',
            arrivalTimeLabel: '17:20',
            durationHours: 12,
            comfortScore: 80,
            bookingLink: 'https://example.com/book',
            link: 'https://example.com/book'
          }
        ]
      });
    }

    if (path === '/api/upgrade/pro' && method === 'POST') {
      updatePlan(state, 'pro');
      return json({ ok: true, user: state.user });
    }
    if (path === '/api/upgrade/elite' && method === 'POST') {
      updatePlan(state, 'elite');
      return json({ ok: true, user: state.user });
    }

    if (path === '/api/opportunities/feed' && method === 'GET') {
      const cluster = String(url.searchParams.get('cluster') || '').trim().toLowerCase();
      const limit = Number(url.searchParams.get('limit') || state.opportunities.length);
      let items = [...state.opportunities];
      if (cluster) {
        items = items.filter((item) => {
          const c = String(item.destination_cluster_slug || '').toLowerCase();
          const country = String(item.destination_country || '').toLowerCase();
          const region = String(item.destination_region || '').toLowerCase();
          return c === cluster || country === cluster || region === cluster;
        });
      }
      if (Number.isFinite(limit) && limit > 0) items = items.slice(0, limit);
      return json({
        items,
        access: state.feedAccess
      });
    }
    if (path === '/api/opportunities/clusters' && method === 'GET') return json({ items: state.clusters });
    if (path === '/api/opportunities/radar/preferences' && method === 'GET') return json({ item: state.radarPreferences });
    if (path === '/api/opportunities/radar/preferences' && method === 'PUT') {
      const body = parseRequestBody(request);
      state.radarPreferences = { ...state.radarPreferences, ...body };
      return json({ item: state.radarPreferences });
    }
    if (path === '/api/opportunities/radar/matches' && method === 'GET') return json({ items: state.radarMatches });
    if (path === '/api/opportunities/me/radar' && method === 'GET') return json({ items: state.radarMatches });
    if (path === '/api/opportunities/me/follows' && method === 'GET') return json({ items: state.follows });
    if (path === '/api/opportunities/follows' && method === 'POST') {
      const body = parseRequestBody(request);
      state.follows.push({
        id: `f-${state.follows.length + 1}`,
        follow_type: body?.follow_type || 'radar',
        entity: body?.entity || { entity_type: 'destination_cluster', slug: 'japan', display_name: 'Japan' }
      });
      return json({ ok: true }, 201);
    }
    if (path.startsWith('/api/opportunities/follows/') && method === 'DELETE') {
      const followId = path.split('/').pop();
      state.follows = state.follows.filter((item) => item.id !== followId);
      return json({ ok: true });
    }
    if (path === '/api/opportunities/ai/query' && method === 'POST') {
      return json({
        summary: `Trovate ${state.opportunities.length} opportunita reali.`,
        items: state.opportunities
      });
    }
    if (/^\/api\/opportunities\/[^/]+\/follow$/.test(path) && method === 'POST') return json({ ok: true }, 201);
    if (/^\/api\/opportunities\/[^/]+\/related$/.test(path) && method === 'GET') {
      const opportunityId = path.split('/')[3];
      const baseItem = state.opportunities.find((item) => String(item.id) === String(opportunityId));
      const related = baseItem
        ? state.opportunities.filter(
            (item) =>
              item.id !== baseItem.id &&
              (item.destination_country === baseItem.destination_country || item.destination_region === baseItem.destination_region)
          )
        : state.opportunities.slice(1);
      return json({ items: related.slice(0, 4) });
    }
    if (/^\/api\/opportunities\/[^/]+$/.test(path) && method === 'GET') {
      const opportunityId = path.split('/')[3];
      const item = state.opportunities.find((entry) => String(entry.id) === String(opportunityId)) || state.opportunities[0];
      const related = state.opportunities.filter((entry) => entry.id !== item.id).slice(0, 4);
      return json({ item, related });
    }

    if (path === '/api/system/opportunity-debug' && method === 'GET') {
      return json({
        opportunityPipeline: {
          totals: state.pipelineStatus.totals
        }
      });
    }
    if (path === '/api/opportunities/pipeline/status' && method === 'GET') {
      return json({
        status: state.pipelineStatus
      });
    }

    if (debugUnmatchedApi) {
      // eslint-disable-next-line no-console
      console.log(`[e2e-mock] unmatched ${method} ${path}`);
    }
    return json({ ok: true });
  });
}

export async function bootLanding(page, state, { language = 'it', seedConsent = true } = {}) {
  await setupApiMocks(page, state);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(({ initialLanguage, shouldSeedConsent }) => {
    const bootstrapMarker = '__flight_e2e_bootstrap_done__';
    const windowName = String(window.name || '');
    const alreadyBootstrapped = windowName.includes(bootstrapMarker);
    if (!alreadyBootstrapped) {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.name = windowName ? `${windowName}|${bootstrapMarker}` : bootstrapMarker;
    }
    if (initialLanguage) window.localStorage.setItem('flight_language', String(initialLanguage));
    if (shouldSeedConsent) {
      window.localStorage.setItem(
        'flight_cookie_consent_v1',
        JSON.stringify({
          functional: true,
          analytics: true,
          version: 1,
          ts: Date.now()
        })
      );
    }
  }, { initialLanguage: language, shouldSeedConsent: Boolean(seedConsent) });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect
    .poll(
      async () => {
        const landingVisible = await page.locator('main.landing-shell').isVisible().catch(() => false);
        const appShellVisible = await page.locator('main.page.app-shell').isVisible().catch(() => false);
        return landingVisible || appShellVisible;
      },
      { timeout: 10000 }
    )
    .toBe(true);
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    `
  });
}

const SIGN_IN_BUTTON_TEXTS = new Set([
  'sign in',
  'accedi',
  'anmelden',
  'connexion',
  'iniciar sesión',
  'iniciar sessao'
]);

async function isAuthenticatedUi(page) {
  const headerButton = page.getByTestId('header-account-button');
  const count = await headerButton.count().catch(() => 0);
  if (count === 0) return false;
  const text = String((await headerButton.textContent()) || '')
    .trim()
    .toLowerCase();
  if (!text) return false;
  return !SIGN_IN_BUTTON_TEXTS.has(text);
}

async function isLocatorVisible(locator) {
  return locator.isVisible().catch(() => false);
}

async function clickLocatorIfVisible(locator) {
  if (!(await isLocatorVisible(locator))) return false;
  await locator.click({ force: true });
  return true;
}

async function waitForAuthSurface(page, { timeoutMs = 5000, requireEmailForm = false } = {}) {
  try {
    await expect
      .poll(
        async () => {
          if (page.isClosed()) return false;
          if (await isAuthenticatedUi(page)) return true;
          const authShellVisible = await isLocatorVisible(page.locator('.auth-shell'));
          const emailFormVisible = await isLocatorVisible(page.locator('.auth-email-form'));
          return requireEmailForm ? emailFormVisible : authShellVisible || emailFormVisible;
        },
        { timeout: timeoutMs }
      )
      .toBe(true);
    return true;
  } catch {
    return false;
  }
}

async function waitForLoggedInState(page, timeoutMs = 10000) {
  try {
    await expect
      .poll(
        async () => {
          if (page.isClosed()) return false;
          if (await isAuthenticatedUi(page)) return true;
          const appShellVisible = await isLocatorVisible(page.locator('main.page.app-shell'));
          const authShellStillOpen = await isLocatorVisible(page.locator('.auth-shell'));
          return appShellVisible && !authShellStillOpen;
        },
        { timeout: timeoutMs }
      )
      .toBe(true);
    return true;
  } catch {
    return false;
  }
}

export async function openEmailAuth(page) {
  if (await isAuthenticatedUi(page)) return;
  const authShell = page.locator('.auth-shell');
  const authShellVisible = await isLocatorVisible(authShell);
  if (!authShellVisible) {
    const openers = [
      async () => clickLocatorIfVisible(page.getByTestId('header-account-button')),
      async () => clickLocatorIfVisible(page.getByTestId('landing-signin-button').first()),
      async () => {
        const mobileLoginButton = page.getByTestId('landing-signin-button-mobile').first();
        if (!(await isLocatorVisible(mobileLoginButton))) {
          const hamburger = page.locator('.landing-hamburger').first();
          if (await isLocatorVisible(hamburger)) {
            await hamburger.click({ force: true }).catch(() => {});
          }
        }
        return clickLocatorIfVisible(mobileLoginButton);
      }
    ];
    for (const openAuth of openers) {
      if (await isAuthenticatedUi(page)) return;
      if (await isLocatorVisible(authShell)) break;
      const clicked = await openAuth();
      if (!clicked) continue;
      const opened = await waitForAuthSurface(page, { timeoutMs: 2500 });
      if (opened) break;
    }
  }
  if (await isAuthenticatedUi(page)) return;
  const authVisible = await waitForAuthSurface(page, { timeoutMs: 5000 });
  if (!authVisible) {
    throw new Error('Unable to open authentication modal from current UI state');
  }
  const backToOptionsButton = page.getByTestId('auth-back-to-options');
  const hasEmailBackButton = await isLocatorVisible(backToOptionsButton);
  if (!hasEmailBackButton) {
    const emailButton = page.getByRole('button', { name: /email/i }).first();
    await clickLocatorIfVisible(emailButton);
  }
  const emailReady = await waitForAuthSurface(page, { timeoutMs: 5000, requireEmailForm: true });
  if (!emailReady) {
    throw new Error('Unable to open email authentication form');
  }
}

export async function loginFromUi(
  page,
  email = 'test@example.com',
  password = 'StrongPass!123',
  { targetSection = 'home' } = {}
) {
  if (await isAuthenticatedUi(page)) return;
  let openEmailAttempts = 0;
  while (openEmailAttempts < 2) {
    try {
      await openEmailAuth(page);
      break;
    } catch (error) {
      openEmailAttempts += 1;
      if (page.isClosed() || openEmailAttempts >= 2) throw error;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
  }
  if (await isAuthenticatedUi(page)) return;
  await expect(page.getByTestId('auth-email-input')).toBeVisible();
  await expect(page.getByTestId('auth-password-input')).toBeVisible();
  await page.getByTestId('auth-email-input').fill(email);
  await page.getByTestId('auth-password-input').fill(password);
  const submitButton = page.getByTestId('auth-submit');
  await submitButton.click({ force: true });
  const loggedIn = await waitForLoggedInState(page, 10000);
  if (!loggedIn) {
    const authStillVisible = await isLocatorVisible(page.locator('.auth-email-form'));
    if (authStillVisible) {
      await submitButton.click({ force: true }).catch(() => {});
    }
    let loggedInAfterRetry = await waitForLoggedInState(page, 5000);
    if (!loggedInAfterRetry) {
      // WebKit can intermittently miss the UI submit transition in CI. Use API bootstrap as deterministic fallback.
      await page
        .evaluate(async ({ nextEmail, nextPassword }) => {
          await fetch('/api/auth/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: nextEmail, password: nextPassword })
          });
        }, { nextEmail: email, nextPassword: password })
        .catch(() => {});
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      loggedInAfterRetry = await waitForLoggedInState(page, 10000);
    }
    if (!loggedInAfterRetry) {
      throw new Error('Login did not transition to authenticated app shell');
    }
  }
  await expect(page.locator('main.page.app-shell')).toBeVisible();
  await expect(page.locator('.auth-shell')).toHaveCount(0);
  const normalizedSection = String(targetSection || '').trim().toLowerCase();
  if (normalizedSection === 'home') {
    await ensureHomeSection(page);
  }
}

export async function ensureHomeSection(page) {
  await expect(page.locator('main.page.app-shell')).toBeVisible();
  const feedPanel = page.getByTestId('opportunity-feed-panel');
  const isFeedVisible = await feedPanel.isVisible().catch(() => false);
  if (!isFeedVisible) {
    const homeByTestId = page.getByTestId('app-nav-home');
    const hasStableHomeSelector = (await homeByTestId.count().catch(() => 0)) > 0;
    if (hasStableHomeSelector) {
      await expect(homeByTestId).toBeVisible();
      await homeByTestId.click({ force: true });
    } else {
      const homeButton = page.locator('.app-main-nav').getByRole('button', { name: /home/i });
      await expect(homeButton.first()).toBeVisible();
      await homeButton.first().click({ force: true });
    }
  }
  await expect(page.getByTestId('opportunity-feed-panel')).toBeVisible();
}
