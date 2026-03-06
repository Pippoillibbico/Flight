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
