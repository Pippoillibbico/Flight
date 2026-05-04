import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { buildAlertsRouter } from '../../server/routes/alerts.js';
import { buildUserExportRouter } from '../../server/routes/user-export.js';
import { buildBillingRouter } from '../../server/routes/billing.js';

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

test('STEP1 access control: /api/watchlist only returns owner items', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'user_a', id: 'user_a' };
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
          watchlists: [
            { id: 'wl_a', userId: 'user_a', flightId: 'FCO-JFK', dateFrom: '2026-10-10', dateTo: '2026-10-15' },
            { id: 'wl_b', userId: 'user_b', flightId: 'MXP-LHR', dateFrom: '2026-11-01', dateTo: '2026-11-05' }
          ],
          alertSubscriptions: [],
          notifications: []
        }),
      nanoid: () => 'id123',
      scanSubscriptionsOnce: async () => {},
      watchlistSchema: { safeParse: () => ({ success: true, data: {} }) },
      alertSubscriptionSchema: { safeParse: () => ({ success: true, data: {} }) },
      alertSubscriptionUpdateSchema: { safeParse: () => ({ success: true, data: {} }) },
      fetchCurrentUser: async () => ({ id: 'user_a', planType: 'pro' }),
      sendMachineError: (_req, res, status, error) => res.status(status).json({ error })
    })
  );

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/watchlist`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(Array.isArray(body.items), true);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].id, 'wl_a');
    assert.equal(body.items.some((item) => item.userId === 'user_b'), false);
  });
});

test('STEP1 access control: /api/watchlist/:id cannot delete another user item', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'user_a', id: 'user_a' };
    next();
  });

  const dbState = {
    watchlists: [
      { id: 'wl_a', userId: 'user_a', flightId: 'FCO-JFK', dateFrom: '2026-10-10', dateTo: '2026-10-15' },
      { id: 'wl_b', userId: 'user_b', flightId: 'MXP-LHR', dateFrom: '2026-11-01', dateTo: '2026-11-05' }
    ],
    alertSubscriptions: [],
    notifications: []
  };

  app.use(
    '/api',
    buildAlertsRouter({
      authGuard: (_req, _res, next) => next(),
      csrfGuard: (_req, _res, next) => next(),
      requireApiScope: () => (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      withDb: async (fn) => {
        const maybeUpdated = await fn(dbState);
        if (maybeUpdated && typeof maybeUpdated === 'object') {
          Object.assign(dbState, maybeUpdated);
        }
        return null;
      },
      nanoid: () => 'id123',
      scanSubscriptionsOnce: async () => {},
      watchlistSchema: { safeParse: () => ({ success: true, data: {} }) },
      alertSubscriptionSchema: { safeParse: () => ({ success: true, data: {} }) },
      alertSubscriptionUpdateSchema: { safeParse: () => ({ success: true, data: {} }) },
      fetchCurrentUser: async () => ({ id: 'user_a', planType: 'pro' }),
      sendMachineError: (_req, res, status, error) => res.status(status).json({ error })
    })
  );

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/watchlist/wl_b`, { method: 'DELETE' });
    assert.equal(response.status, 404);
    assert.equal(dbState.watchlists.some((item) => item.id === 'wl_b' && item.userId === 'user_b'), true);
  });
});

test('STEP1 access control: /api/user/data-export only contains owner data', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'user_a', id: 'user_a' };
    req.authSource = 'cookie';
    next();
  });

  app.use(
    '/api',
    buildUserExportRouter({
      authGuard: (_req, _res, next) => next(),
      requireSessionAuth: (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      withDb: async () => {},
      fetchCurrentUser: async () => ({ id: 'user_a', planType: 'elite' }),
      readDb: async () => ({
        searches: [
          { id: 's1', userId: 'user_a', payload: { origin: 'FCO', destination: 'JFK' } },
          { id: 's2', userId: 'user_b', payload: { origin: 'MXP', destination: 'LHR' } }
        ],
        priceAlerts: [
          { id: 'p1', userId: 'user_a', origin: 'FCO', destinationIata: 'JFK', enabled: true },
          { id: 'p2', userId: 'user_b', origin: 'MXP', destinationIata: 'LHR', enabled: true }
        ],
        watchlists: [
          { id: 'w1', userId: 'user_a', origin: 'FCO', destination: 'JFK' },
          { id: 'w2', userId: 'user_b', origin: 'MXP', destination: 'LHR' }
        ],
        notifications: [
          { id: 'n1', userId: 'user_a', type: 'alert', message: 'A' },
          { id: 'n2', userId: 'user_b', type: 'alert', message: 'B' }
        ]
      })
    })
  );

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/user/data-export`, {
      headers: {
        'x-export-reason': 'security_access_control_owner_validation'
      }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user_id, 'user_a');
    assert.equal(body.search_history.length, 1);
    assert.equal(body.price_alerts.length, 1);
    assert.equal(body.watchlist.length, 1);
    assert.equal(body.notifications.length, 1);
  });
});

test('STEP1 access control: /api/billing/subscription/sync uses session user context', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'user_a', id: 'user_a' };
    req.authSource = 'cookie';
    next();
  });

  const calls = [];
  const billingService = {
    handleWebhook: async (_req, res) => res.status(200).json({ ok: true }),
    getPublicConfig: () => ({ status: 200, body: { ok: true } }),
    getSubscription: async () => ({}),
    syncSubscription: async (userId) => {
      calls.push({ userId });
      return { status: 200, body: { ok: true } };
    },
    changePlan: async (userId, payload) => {
      calls.push({ userId, payload });
      return { status: 200, body: { ok: true } };
    },
    cancelSubscription: async () => ({ status: 200, body: { ok: true } }),
    resumeSubscription: async () => ({ status: 200, body: { ok: true } }),
    createCheckout: async () => ({ status: 200, body: { ok: true } }),
    createPortal: async () => ({ status: 200, body: { ok: true } })
  };

  app.use(
    '/api/billing',
    buildBillingRouter(
      {
        authGuard: (_req, _res, next) => next(),
        requireSessionAuth: (_req, _res, next) => next(),
        csrfGuard: (_req, _res, next) => next()
      },
      { billingService }
    )
  );

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/billing/subscription/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user_b' })
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].userId, 'user_a');
  });
});
