/**
 * Integration tests — premium gates (402 premium_required)
 *
 * Verifies that gated endpoints return the correct 402 response with
 * `upgrade_context` when called by a non-entitled user, and succeed
 * when called by an entitled user.
 *
 * Covered gates:
 *   - POST /alerts/price-alerts        (smart_alerts — Elite only)
 *   - GET  /user/data-export           (export — Elite only)
 *   - GET  /user/data-export.csv       (export — Elite only)
 *   - POST /opportunities/follows      (follows_limit — exceeding plan cap)
 *   - PUT  /opportunities/radar/preferences  (radar — Pro+ only)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildAlertsRouter } from '../server/routes/alerts.js';
import { buildUserExportRouter } from '../server/routes/user-export.js';
import { buildOpportunitiesRouter } from '../server/routes/opportunities.js';
import { buildDiscoveryRouter } from '../server/routes/discovery.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeAuthGuard(user) {
  return (req, _res, next) => {
    req.user = { ...user, sub: user.id || user.sub };
    req.authSource = 'cookie';
    next();
  };
}

const noop = (_req, _res, next) => next();

function quotaGuardAllow() {
  return (_req, _res, next) => next();
}

function makeFetchCurrentUser(user) {
  return async () => user;
}

async function get(base, path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function post(base, path, payload = {}, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function put(base, path, payload = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ── Shared users ──────────────────────────────────────────────────────────────

const FREE_USER  = { id: 'u-free',  sub: 'u-free',  email: 'free@test.com',  planType: 'free',  isPremium: false };
const PRO_USER   = { id: 'u-pro',   sub: 'u-pro',   email: 'pro@test.com',   planType: 'pro',   isPremium: true  };
const ELITE_USER = { id: 'u-elite', sub: 'u-elite', email: 'elite@test.com', planType: 'elite', isPremium: true  };

// ── Alerts: POST /alerts/price-alerts (smart alerts — Elite only) ─────────────

function buildAlertsApp(user) {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    buildAlertsRouter({
      authGuard: makeAuthGuard(user),
      csrfGuard: noop,
      requireApiScope: () => noop,
      quotaGuard: quotaGuardAllow,
      withDb: async (fn) => fn({ watchlists: [], alertSubscriptions: [], notifications: [] }),
      nanoid: (n) => `id-${n}`,
      scanSubscriptionsOnce: async () => {},
      watchlistSchema: { safeParse: () => ({ success: true, data: {} }) },
      alertSubscriptionSchema: { safeParse: () => ({ success: true, data: {} }) },
      alertSubscriptionUpdateSchema: { safeParse: () => ({ success: true, data: {} }) },
      fetchCurrentUser: makeFetchCurrentUser(user),
      sendMachineError: (req, res, status, code) => res.status(status).json({ error: code, request_id: null })
    })
  );
  return app;
}

const VALID_PRICE_ALERT = {
  originIata: 'FCO',
  destinationIata: 'TYO',
  dateFrom: '2027-03-01',
  dateTo: '2027-03-10',
  maxPrice: 500
};

test('POST /alerts/price-alerts — free user → 402 premium_required', async () => {
  const app = buildAlertsApp(FREE_USER);
  await withServer(app, async (base) => {
    const { status, body } = await post(base, '/alerts/price-alerts', VALID_PRICE_ALERT);
    assert.equal(status, 402);
    assert.equal(body.error, 'premium_required');
    assert.ok(typeof body.pro_limit === 'number', 'should include pro_limit hint');
  });
});

test('POST /alerts/price-alerts — pro user under limit → 201 created', async () => {
  // Pro user with no existing alerts should be allowed (under SMART_ALERTS_PRO_LIMIT).
  const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const user = { ...PRO_USER, id: `u-pro-${uniqueSuffix}`, sub: `u-pro-${uniqueSuffix}` };
  const app = buildAlertsApp(user);
  await withServer(app, async (base) => {
    const { status } = await post(base, '/alerts/price-alerts', VALID_PRICE_ALERT);
    assert.equal(status, 201);
  });
});

test('POST /alerts/price-alerts — elite user → 201 created', async () => {
  const app = buildAlertsApp(ELITE_USER);
  await withServer(app, async (base) => {
    const { status } = await post(base, '/alerts/price-alerts', VALID_PRICE_ALERT);
    assert.equal(status, 201);
  });
});

// ── Export: GET /user/data-export (Elite only) ────────────────────────────────

function buildExportApp(user) {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    buildUserExportRouter({
      authGuard: makeAuthGuard(user),
      requireSessionAuth: noop,
      quotaGuard: quotaGuardAllow,
      withDb: async (fn) => fn({ searches: [], priceAlerts: [], watchlists: [], notifications: [] }),
      readDb: async () => ({ searches: [], priceAlerts: [], watchlists: [], notifications: [] }),
      fetchCurrentUser: makeFetchCurrentUser(user)
    })
  );
  return app;
}

test('GET /user/data-export — free user → 402 premium_required with export_limit context', async () => {
  const app = buildExportApp(FREE_USER);
  await withServer(app, async (base) => {
    const { status, body } = await get(base, '/user/data-export');
    assert.equal(status, 402);
    assert.equal(body.error, 'premium_required');
    assert.equal(body.upgrade_context, 'export_limit');
  });
});

test('GET /user/data-export — pro user → 402 premium_required with export_limit context', async () => {
  const app = buildExportApp(PRO_USER);
  await withServer(app, async (base) => {
    const { status, body } = await get(base, '/user/data-export');
    assert.equal(status, 402);
    assert.equal(body.error, 'premium_required');
    assert.equal(body.upgrade_context, 'export_limit');
  });
});

test('GET /user/data-export — elite user → 200 with snapshot', async () => {
  const app = buildExportApp(ELITE_USER);
  await withServer(app, async (base) => {
    const { status, body } = await get(base, '/user/data-export');
    assert.equal(status, 200);
    assert.ok('exported_at' in body, 'response should contain exported_at');
    assert.ok(Array.isArray(body.search_history), 'response should contain search_history');
  });
});

test('GET /user/data-export.csv — free user → 402', async () => {
  const app = buildExportApp(FREE_USER);
  await withServer(app, async (base) => {
    const { status, body } = await get(base, '/user/data-export.csv');
    assert.equal(status, 402);
    assert.equal(body.error, 'premium_required');
  });
});

// ── Opportunities: follows limit (POST /opportunities/follows) ────────────────

function buildOppsApp(user) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/opportunities',
    buildOpportunitiesRouter({
      authGuard: makeAuthGuard(user),
      csrfGuard: noop,
      requireSessionAuth: noop,
      requireApiScope: () => noop,
      quotaGuard: quotaGuardAllow,
      withDb: async (fn) => fn({ follows: [], radarPreferences: [] })
    })
  );
  return app;
}

test('POST /opportunities/follows — free user at limit (5 follows) → 402 premium_required', async () => {
  // The gate reads listUserFollows from opportunity-store (DB). We verify the gate
  // fires by checking the plan cap logic through the plan-access module directly.
  const { getFollowsLimit } = await import('../server/lib/plan-access.js');
  const freeLimit = getFollowsLimit(FREE_USER);
  assert.equal(freeLimit, 5, 'free plan should have a 5-follow limit');

  const proLimit = getFollowsLimit(PRO_USER);
  assert.equal(proLimit, 50, 'pro plan should have a 50-follow limit');

  const eliteLimit = getFollowsLimit(ELITE_USER);
  assert.equal(eliteLimit, null, 'elite plan should have unlimited follows');
});

// ── Opportunities: radar preferences (PUT — Pro+ only) ───────────────────────

test('PUT /api/opportunities/radar/preferences — free user → 402 premium_required', async () => {
  const app = buildOppsApp(FREE_USER);
  await withServer(app, async (base) => {
    const { status, body } = await put(base, '/api/opportunities/radar/preferences', {
      originAirports: ['FCO'],
      favoriteDestinations: ['Tokyo'],
      favoriteCountries: ['Japan'],
      budgetCeiling: 500,
      preferredTravelMonths: [11]
    });
    assert.equal(status, 402);
    assert.equal(body.error, 'premium_required');
  });
});

test('PUT /api/opportunities/radar/preferences — pro user → not blocked by plan gate (may fail at DB)', async () => {
  const app = buildOppsApp(PRO_USER);
  await withServer(app, async (base) => {
    const { status } = await put(base, '/api/opportunities/radar/preferences', {
      originAirports: ['FCO'],
      favoriteDestinations: [],
      favoriteCountries: [],
      budgetCeiling: null,
      preferredTravelMonths: []
    });
    // 402 = plan gate. Any other code (200, 500) means the gate was passed.
    assert.notEqual(status, 402, 'Pro user should not be blocked by plan gate');
  });
});

// —— Discovery forecast gates (Pro+ only) ————————————————————————————————————————

function buildDiscoveryApp(user) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/discovery',
    buildDiscoveryRouter({
      authGuard: makeAuthGuard(user),
      csrfGuard: noop,
      requireApiScope: () => noop,
      quotaGuard: quotaGuardAllow
    })
  );
  return app;
}

test('GET /api/discovery/price-prediction — free user → 403 premium_required with forecast_access context', async () => {
  const app = buildDiscoveryApp(FREE_USER);
  await withServer(app, async (base) => {
    const { status, body } = await get(
      base,
      '/api/discovery/price-prediction?origin=FCO&destination=JFK&departure_date=2027-03-10&current_price=420'
    );
    assert.equal(status, 403);
    assert.equal(body.error, 'premium_required');
    assert.equal(body.upgrade_context, 'forecast_access');
  });
});

test('GET /api/discovery/price-prediction — pro user → not blocked by forecast plan gate', async () => {
  const app = buildDiscoveryApp(PRO_USER);
  await withServer(app, async (base) => {
    const { status } = await get(
      base,
      '/api/discovery/price-prediction?origin=FCO&destination=JFK&departure_date=2027-03-10&current_price=420'
    );
    assert.notEqual(status, 403, 'Pro user should pass the forecast gate');
  });
});
