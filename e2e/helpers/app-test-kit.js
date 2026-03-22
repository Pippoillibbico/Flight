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
    billingProvider: 'braintree',
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
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    const json = (payload, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(payload)
      });

    if (path === '/api/config') {
      return json({
        origins: [
          { code: 'FCO', label: 'Roma Fiumicino (FCO)' },
          { code: 'MXP', label: 'Milano Malpensa (MXP)' }
        ],
        regions: ['all', 'eu', 'asia', 'america', 'oceania'],
        cabins: ['economy', 'premium', 'business'],
        connectionTypes: ['all', 'direct', 'with_stops'],
        travelTimes: ['all', 'day', 'night'],
        countriesByRegion: {}
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
      const provider = String(state.billingProvider || 'braintree').trim().toLowerCase();
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
      const provider = String(state.billingProvider || 'braintree').trim().toLowerCase();
      if (provider !== 'braintree') {
        return json(
          {
            error: 'billing_provider_not_supported',
            message: 'Client token endpoint is available only with Braintree.'
          },
          400
        );
      }
      return json({
        provider: 'braintree',
        clientToken: 'test-client-token'
      });
    }

    if (path === '/api/billing/checkout' && method === 'POST') {
      const body = parseRequestBody(request);
      const provider = String(state.billingProvider || 'braintree').trim().toLowerCase();
      if (provider !== 'braintree') {
        return json(
          {
            error: 'billing_provider_not_supported',
            message: 'Checkout endpoint requires Braintree provider.'
          },
          400
        );
      }

      const planType = normalizePlan(body?.planType || 'free');
      const paymentMethodNonce = String(body?.paymentMethodNonce || '').trim();
      if (!paymentMethodNonce) {
        return json(
          {
            error: 'payment_method_failed',
            message: 'Payment method could not be verified.'
          },
          402
        );
      }

      updatePlan(state, planType === 'elite' ? 'elite' : 'pro');
      return json(
        {
          ok: true,
          provider: 'braintree',
          planType: planType === 'elite' ? 'elite' : 'pro',
          subscription: {
            id: `sub_${Date.now()}`,
            status: 'active',
            currentPeriodStart: new Date().toISOString(),
            currentPeriodEnd: null
          }
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

    return json({ ok: true });
  });
}

export async function bootLanding(page, state, { language = 'it' } = {}) {
  await setupApiMocks(page, state);
  await page.addInitScript(({ initialLanguage }) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    if (initialLanguage) window.localStorage.setItem('flight_language', String(initialLanguage));
  }, { initialLanguage: language });
  await page.goto('/');
  await expect(page.locator('main.landing-shell')).toBeVisible();
}

export async function openEmailAuth(page) {
  await page.locator('.landing-accedi-btn').first().click();
  await expect(page.locator('.auth-shell')).toBeVisible();
  if ((await page.locator('.auth-email-form').count()) === 0) {
    await page.locator('.auth-provider-btn').first().click();
  }
  await expect(page.locator('.auth-email-form')).toBeVisible();
}

export async function loginFromUi(page, email = 'test@example.com', password = 'StrongPass!123') {
  await openEmailAuth(page);
  await page.locator('.auth-email-form input[type="email"]').fill(email);
  await page.locator('.auth-email-form input[type="password"]').first().fill(password);
  await page.locator('.auth-email-form button[type="submit"]').click();
  await expect(page.locator('main.page.app-shell')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test User' })).toBeVisible();
}
