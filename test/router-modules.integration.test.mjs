import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildSystemRouter } from '../server/routes/system.js';
import { buildSearchRouter } from '../server/routes/search.js';
import { buildAlertsRouter } from '../server/routes/alerts.js';

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('system router exposes /health', async () => {
  const app = express();
  app.use(
    buildSystemRouter({
      BUILD_VERSION: 'test-version',
      pgPool: null,
      getPriceDatasetStatus: async () => ({ routes: 1 }),
      logger: { error: () => {}, warn: () => {}, info: () => {} },
      getCacheClient: () => ({ ping: async () => 'PONG' }),
      readDb: async () => ({ revokedTokens: [], refreshSessions: [], oauthSessions: [] }),
      verifyImmutableAudit: async () => ({ ok: true, count: 0 }),
      createAuditCheck: (id, label, ok, detail) => ({ id, label, ok, detail }),
      CORS_ALLOWLIST: new Set(['http://localhost:5173']),
      LOGIN_MAX_FAILURES: 5,
      LOGIN_LOCK_MINUTES: 15,
      runFeatureAudit: () => ({ ok: true }),
      getDataFoundationStatus: async () => ({
        ok: true,
        mode: 'sqlite',
        totals: { priceObservations: 1, routeBaselines: 1, routeCoverageStats: 1, activeSubscriptions: 1 },
        coverage: { high: 1, medium: 0, low: 0, veryLow: 0 }
      }),
      providerRegistry: { listProviders: () => [{ name: 'duffel', configured: false }, { name: 'amadeus', configured: false }] }
    })
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });
});

test('system router exposes /api/system/data-status', async () => {
  const app = express();
  app.use(
    buildSystemRouter({
      BUILD_VERSION: 'test-version',
      pgPool: null,
      getPriceDatasetStatus: async () => ({ routes: 1 }),
      logger: { error: () => {}, warn: () => {}, info: () => {} },
      getCacheClient: () => ({ ping: async () => 'PONG' }),
      readDb: async () => ({ revokedTokens: [], refreshSessions: [], oauthSessions: [] }),
      verifyImmutableAudit: async () => ({ ok: true, count: 0 }),
      createAuditCheck: (id, label, ok, detail) => ({ id, label, ok, detail }),
      CORS_ALLOWLIST: new Set(['http://localhost:5173']),
      LOGIN_MAX_FAILURES: 5,
      LOGIN_LOCK_MINUTES: 15,
      runFeatureAudit: () => ({ ok: true }),
      getDataFoundationStatus: async () => ({
        ok: true,
        mode: 'sqlite',
        totals: { priceObservations: 2, routeBaselines: 1, routeCoverageStats: 1, activeSubscriptions: 1 },
        coverage: { high: 1, medium: 0, low: 0, veryLow: 0 }
      }),
      providerRegistry: { listProviders: () => [{ name: 'duffel', configured: true }, { name: 'amadeus', configured: false }] }
    })
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/system/data-status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.totals.priceObservations > 0, true);
    assert.equal(typeof body.providers.duffelConfigured, 'boolean');
  });
});

test('system router protects sensitive status endpoints with admin guard', async () => {
  const app = express();
  app.use(
    buildSystemRouter({
      BUILD_VERSION: 'test-version',
      pgPool: null,
      getPriceDatasetStatus: async () => ({ routes: 1 }),
      logger: { error: () => {}, warn: () => {}, info: () => {} },
      getCacheClient: () => ({ ping: async () => 'PONG' }),
      readDb: async () => ({ revokedTokens: [], refreshSessions: [], oauthSessions: [] }),
      verifyImmutableAudit: async () => ({ ok: true, count: 0 }),
      createAuditCheck: (id, label, ok, detail) => ({ id, label, ok, detail }),
      CORS_ALLOWLIST: new Set(['http://localhost:5173']),
      LOGIN_MAX_FAILURES: 5,
      LOGIN_LOCK_MINUTES: 15,
      runFeatureAudit: () => ({ ok: true }),
      getDataFoundationStatus: async () => ({
        ok: true,
        mode: 'sqlite',
        totals: { priceObservations: 2, routeBaselines: 1, routeCoverageStats: 1, activeSubscriptions: 1 },
        coverage: { high: 1, medium: 0, low: 0, veryLow: 0 }
      }),
      providerRegistry: { listProviders: () => [{ name: 'duffel', configured: true }, { name: 'amadeus', configured: false }] },
      authGuard: (req, _res, next) => {
        req.user = { sub: 'u1', email: 'user@example.com' };
        next();
      },
      adminGuard: (_req, res) => res.status(403).json({ error: 'admin_access_denied' })
    })
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/system/data-status`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'admin_access_denied');
  });
});

test('system router exposes /api/health/observability', async () => {
  const app = express();
  app.use(
    buildSystemRouter({
      BUILD_VERSION: 'test-version',
      pgPool: null,
      getPriceDatasetStatus: async () => ({ routes: 1 }),
      logger: { error: () => {}, warn: () => {}, info: () => {} },
      getCacheClient: () => ({ ping: async () => 'PONG' }),
      readDb: async () => ({ revokedTokens: [], refreshSessions: [], oauthSessions: [] }),
      verifyImmutableAudit: async () => ({ ok: true, count: 0 }),
      createAuditCheck: (id, label, ok, detail) => ({ id, label, ok, detail }),
      CORS_ALLOWLIST: new Set(['http://localhost:5173']),
      LOGIN_MAX_FAILURES: 5,
      LOGIN_LOCK_MINUTES: 15,
      runFeatureAudit: () => ({ ok: true }),
      getDataFoundationStatus: async () => ({
        ok: true,
        mode: 'sqlite',
        totals: { priceObservations: 2, routeBaselines: 1, routeCoverageStats: 1, activeSubscriptions: 1 },
        coverage: { high: 1, medium: 0, low: 0, veryLow: 0 }
      }),
      getOpportunityPipelineStats: async () => ({ apiQuality: { filteredOutSinceBoot: 3 } }),
      getDiscoveryFeedRuntimeMetrics: () => ({ freshBuildsTotal: 11, cacheHitsTotal: 5, skippedTotal: 1 }),
      providerRegistry: {
        runtimeStats: () => [{ name: 'duffel', totalSearches: 5, failures: 1, rejectedOffers: 2 }]
      }
    })
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health/observability`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(Array.isArray(body.providerRuntime), true);
    assert.equal(body.pipelineQuality.filteredOutSinceBoot, 3);
    assert.equal(body.pipelineQuality.discoveryFeed.freshBuildsTotal, 11);
    assert.equal(body.counters.providerSearches, 5);
    assert.equal(body.counters.discoveryFeedCacheHits, 5);
  });
});

test('system router exposes flight scan status and manual run endpoints', async () => {
  const app = express();
  app.use(express.json());
  let schedulerRuns = 0;
  let workerRuns = 0;
  let cycleRuns = 0;
  app.use(
    buildSystemRouter({
      BUILD_VERSION: 'test-version',
      pgPool: null,
      getPriceDatasetStatus: async () => ({ routes: 1 }),
      logger: { error: () => {}, warn: () => {}, info: () => {} },
      getCacheClient: () => ({ ping: async () => 'PONG' }),
      readDb: async () => ({ revokedTokens: [], refreshSessions: [], oauthSessions: [] }),
      verifyImmutableAudit: async () => ({ ok: true, count: 0 }),
      createAuditCheck: (id, label, ok, detail) => ({ id, label, ok, detail }),
      CORS_ALLOWLIST: new Set(['http://localhost:5173']),
      LOGIN_MAX_FAILURES: 5,
      LOGIN_LOCK_MINUTES: 15,
      RL_AUTH_PER_MINUTE: 15,
      runFeatureAudit: () => ({ ok: true }),
      getDataFoundationStatus: async () => ({
        ok: true,
        mode: 'sqlite',
        totals: { priceObservations: 2, routeBaselines: 1, routeCoverageStats: 1, activeSubscriptions: 1 },
        coverage: { high: 1, medium: 0, low: 0, veryLow: 0 }
      }),
      providerRegistry: { listProviders: () => [] },
      getRuntimeConfigAudit: () => ({ checks: [], summary: { blockingFailed: 0 }, blockingFailedKeys: [] }),
      evaluateStartupReadiness: () => ({ ok: true, summary: { policy: { blockingFailed: 0 } }, runtimeAudit: { checks: [] } }),
      authGuard: (_req, _res, next) => next(),
      requireSessionAuth: (_req, _res, next) => next(),
      adminGuard: (_req, _res, next) => next(),
      csrfGuard: (_req, _res, next) => next(),
      requireApiScope: () => (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      FLIGHT_SCAN_ENABLED: true,
      getFlightScanStatus: async () => ({ ok: true, queue: { pending: 3, deadLettered: 1 } }),
      runFlightScanSchedulerOnce: async () => {
        schedulerRuns += 1;
        return { skipped: false, enqueued: 10 };
      },
      runFlightScanWorkerOnce: async () => {
        workerRuns += 1;
        return { skipped: false, processedTasks: 8 };
      },
      runFlightScanCycleOnce: async () => {
        cycleRuns += 1;
        return { skipped: false, workerPassesExecuted: 2, queueDepthAfter: 0 };
      }
    })
  );

  await withServer(app, async (baseUrl) => {
    const statusRes = await fetch(`${baseUrl}/api/system/flight-scan/status`);
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.enabled, true);
    assert.equal(statusBody.queue.pending, 3);

    const schedRes = await fetch(`${baseUrl}/api/system/flight-scan/scheduler/run`, {
      method: 'POST'
    });
    assert.equal(schedRes.status, 200);
    const schedBody = await schedRes.json();
    assert.equal(schedBody.ok, true);

    const workerRes = await fetch(`${baseUrl}/api/system/flight-scan/worker/run`, {
      method: 'POST'
    });
    assert.equal(workerRes.status, 200);
    const workerBody = await workerRes.json();
    assert.equal(workerBody.ok, true);

    const cycleRes = await fetch(`${baseUrl}/api/system/flight-scan/run`, {
      method: 'POST'
    });
    assert.equal(cycleRes.status, 200);
    const cycleBody = await cycleRes.json();
    assert.equal(cycleBody.ok, true);
  });

  assert.equal(schedulerRuns, 1);
  assert.equal(workerRuns, 1);
  assert.equal(cycleRuns, 1);
});

test('system router rejects non-admin access to flight scan operational endpoints', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    buildSystemRouter({
      BUILD_VERSION: 'test-version',
      pgPool: null,
      getPriceDatasetStatus: async () => ({ routes: 1 }),
      logger: { error: () => {}, warn: () => {}, info: () => {} },
      getCacheClient: () => ({ ping: async () => 'PONG' }),
      readDb: async () => ({ revokedTokens: [], refreshSessions: [], oauthSessions: [] }),
      verifyImmutableAudit: async () => ({ ok: true, count: 0 }),
      createAuditCheck: (id, label, ok, detail) => ({ id, label, ok, detail }),
      CORS_ALLOWLIST: new Set(['http://localhost:5173']),
      LOGIN_MAX_FAILURES: 5,
      LOGIN_LOCK_MINUTES: 15,
      RL_AUTH_PER_MINUTE: 15,
      runFeatureAudit: () => ({ ok: true }),
      getDataFoundationStatus: async () => ({
        ok: true,
        mode: 'sqlite',
        totals: { priceObservations: 2, routeBaselines: 1, routeCoverageStats: 1, activeSubscriptions: 1 },
        coverage: { high: 1, medium: 0, low: 0, veryLow: 0 }
      }),
      providerRegistry: { listProviders: () => [] },
      authGuard: (_req, _res, next) => next(),
      requireSessionAuth: (_req, _res, next) => next(),
      adminGuard: (_req, res) => res.status(403).json({ error: 'admin_access_denied' }),
      csrfGuard: (_req, _res, next) => next(),
      requireApiScope: () => (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      FLIGHT_SCAN_ENABLED: true,
      getFlightScanStatus: async () => ({ ok: true, queue: { pending: 3 } }),
      runFlightScanSchedulerOnce: async () => ({ skipped: false }),
      runFlightScanWorkerOnce: async () => ({ skipped: false }),
      runFlightScanCycleOnce: async () => ({ skipped: false })
    })
  );

  await withServer(app, async (baseUrl) => {
    const statusRes = await fetch(`${baseUrl}/api/system/flight-scan/status`);
    assert.equal(statusRes.status, 403);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.error, 'admin_access_denied');

    const runRes = await fetch(`${baseUrl}/api/system/flight-scan/run`, { method: 'POST' });
    assert.equal(runRes.status, 403);
    const runBody = await runRes.json();
    assert.equal(runBody.error, 'admin_access_denied');
  });
});

test('search router sets cache headers on public config endpoints', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    buildSearchRouter({
      ORIGINS: [{ code: 'FCO', label: 'Roma Fiumicino (FCO)' }],
      REGION_ENUM: ['all', 'eu'],
      CABIN_ENUM: ['economy'],
      CONNECTION_ENUM: ['all'],
      TRAVEL_TIME_ENUM: ['all'],
      DESTINATIONS: [{ region: 'eu', country: 'Italy' }],
      COUNTRIES: [{ name: 'Italy', officialName: 'Italian Republic', cca2: 'IT', region: 'Europe' }],
      getDestinationSuggestions: () => [{ type: 'city', value: 'Rome', label: 'Rome (Italy)' }],
      searchFlights: () => ({ items: [], meta: {} }),
      decideTrips: () => ({ recommendations: [], meta: {} }),
      ensureAiPremiumAccess: async () => ({ allowed: true }),
      enrichDecisionWithAi: async () => ({ provider: 'none' }),
      parseIntentWithAi: async () => ({ ok: true }),
      searchSchema: { safeParse: () => ({ success: true, data: {} }) },
      justGoSchema: { safeParse: () => ({ success: true, data: {} }) },
      decisionIntakeSchema: { safeParse: () => ({ success: true, data: {} }) },
      authGuard: (_req, _res, next) => next(),
      csrfGuard: (_req, _res, next) => next(),
      requireApiScope: () => (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      withDb: async () => {},
      insertSearchEvent: async () => {},
      nanoid: () => 'id123',
      sendMachineError: (_req, res, status, error) => res.status(status).json({ error })
    })
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('cache-control') || ''), /max-age=300/);
  });
});

test('alerts router returns watchlist items for authenticated user', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'u1', email: 'user@example.com' };
    next();
  });
  app.use(
    '/api',
    buildAlertsRouter({
      authGuard: (_req, _res, next) => next(),
      csrfGuard: (_req, _res, next) => next(),
      requireApiScope: () => (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      withDb: async (fn) =>
        fn({
          watchlists: [{ id: 'w1', userId: 'u1', flightId: 'FCO-PAR' }],
          alertSubscriptions: [],
          notifications: []
        }),
      nanoid: () => 'id123',
      scanSubscriptionsOnce: async () => {},
      watchlistSchema: { safeParse: () => ({ success: true, data: {} }) },
      alertSubscriptionSchema: { safeParse: () => ({ success: true, data: {} }) },
      alertSubscriptionUpdateSchema: { safeParse: () => ({ success: true, data: {} }) },
      fetchCurrentUser: async () => ({ id: 'u1', isPremium: true }),
      sendMachineError: (_req, res, status, error) => res.status(status).json({ error })
    })
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/watchlist`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].id, 'w1');
  });
});

test('alerts router supports price alerts CRUD and manual scan', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'u1', email: 'user@example.com' };
    next();
  });

  const memoryAlerts = [];
  const priceAlertsStore = {
    async listPriceAlerts({ userId }) {
      return memoryAlerts.filter((item) => item.user_id === userId);
    },
    async createPriceAlert(payload) {
      const item = {
        id: 'pa_1',
        user_id: payload.userId,
        origin_iata: payload.originIata,
        destination_iata: payload.destinationIata,
        date_from: payload.dateFrom,
        date_to: payload.dateTo,
        max_price: payload.maxPrice,
        currency: payload.currency || 'EUR',
        channels: payload.channels || { push: true, email: true, in_app: true },
        enabled: payload.enabled ?? true
      };
      memoryAlerts.push(item);
      return item;
    },
    async updatePriceAlert({ userId, alertId, patch }) {
      const hit = memoryAlerts.find((item) => item.id === alertId && item.user_id === userId);
      if (!hit) return null;
      if (patch.maxPrice != null) hit.max_price = patch.maxPrice;
      if (patch.enabled != null) hit.enabled = patch.enabled;
      return hit;
    },
    async deletePriceAlert({ userId, alertId }) {
      const before = memoryAlerts.length;
      const kept = memoryAlerts.filter((item) => !(item.id === alertId && item.user_id === userId));
      memoryAlerts.length = 0;
      memoryAlerts.push(...kept);
      return { removed: before !== memoryAlerts.length };
    }
  };

  app.use(
    '/api',
    buildAlertsRouter({
      authGuard: (_req, _res, next) => next(),
      csrfGuard: (_req, _res, next) => next(),
      requireApiScope: () => (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      withDb: async (fn) =>
        fn({
          watchlists: [],
          alertSubscriptions: [],
          notifications: []
        }),
      nanoid: () => 'id123',
      scanSubscriptionsOnce: async () => {},
      scanPriceAlertsOnce: async () => ({ skipped: false, processed: 1 }),
      watchlistSchema: { safeParse: () => ({ success: true, data: {} }) },
      alertSubscriptionSchema: { safeParse: () => ({ success: true, data: {} }) },
      alertSubscriptionUpdateSchema: { safeParse: () => ({ success: true, data: {} }) },
      fetchCurrentUser: async () => ({ id: 'u1', isPremium: true }),
      sendMachineError: (_req, res, status, error) => res.status(status).json({ error }),
      priceAlertsStore
    })
  );

  await withServer(app, async (baseUrl) => {
    const createRes = await fetch(`${baseUrl}/api/alerts/price-alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originIata: 'FCO',
        destinationIata: 'JFK',
        dateFrom: '2026-05-10',
        dateTo: '2026-05-20',
        maxPrice: 350
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.item.id, 'pa_1');

    const listRes = await fetch(`${baseUrl}/api/alerts/price-alerts`);
    assert.equal(listRes.status, 200);
    const listed = await listRes.json();
    assert.equal(listed.items.length, 1);

    const patchRes = await fetch(`${baseUrl}/api/alerts/price-alerts/pa_1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPrice: 299, enabled: false })
    });
    assert.equal(patchRes.status, 200);
    const patched = await patchRes.json();
    assert.equal(patched.item.max_price, 299);
    assert.equal(patched.item.enabled, false);

    const scanRes = await fetch(`${baseUrl}/api/alerts/price-alerts/scan`, {
      method: 'POST'
    });
    assert.equal(scanRes.status, 200);
    const scan = await scanRes.json();
    assert.equal(scan.ok, true);

    const deleteRes = await fetch(`${baseUrl}/api/alerts/price-alerts/pa_1`, {
      method: 'DELETE'
    });
    assert.equal(deleteRes.status, 204);
  });
});
