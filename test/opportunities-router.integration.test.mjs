import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildOpportunitiesRouter } from '../server/routes/opportunities.js';

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

function createRouterApp({
  user = { id: 'u1', planType: 'elite', planStatus: 'active', isPremium: true },
  optionalAuthEnabled = false,
  requireSessionAuth = (_req, _res, next) => next(),
  adminGuard = (_req, _res, next) => next()
} = {}) {
  const state = {
    users: [user],
    radarPreferences: [],
    radarMatchSnapshots: [],
    alertSubscriptions: []
  };
  const withDb = async (fn) => {
    const out = await fn(state);
    if (out && typeof out === 'object') Object.assign(state, out);
    return out;
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/opportunities',
    buildOpportunitiesRouter({
      authGuard: (req, _res, next) => {
        req.user = { id: user.id, sub: user.id };
        next();
      },
      requireSessionAuth,
      adminGuard,
      csrfGuard: (_req, _res, next) => next(),
      requireApiScope: () => (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      withDb,
      optionalAuth: optionalAuthEnabled
        ? (req) => {
            req.user = { id: user.id, sub: user.id };
            return { sub: user.id };
          }
        : () => null
    })
  );
  return { app, state };
}

test('opportunities feed endpoint returns list without auth', async () => {
  const { app } = createRouterApp({ optionalAuthEnabled: false });
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/opportunities/feed?limit=5`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, 'travel_opportunities');
    assert.equal(Array.isArray(body.items), true);
    assert.equal(body.items.length <= 5, true);
  });
});

test('opportunities feed returns localized-agnostic upgrade message key for capped plans', async () => {
  const { app } = createRouterApp({
    optionalAuthEnabled: true,
    user: { id: 'u3', planType: 'free', planStatus: 'active', isPremium: false }
  });
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/opportunities/feed?limit=20`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, 'travel_opportunities');
    assert.equal(Array.isArray(body.items), true);
    assert.equal(typeof body.access, 'object');
    assert.equal(body.access.planType, 'free');
    if (body.access.showUpgradePrompt) {
      assert.equal(body.access.upgradeMessageKey, 'upgradePromptUnlockAll');
    }
  });
});

test('opportunities follows CRUD works for authenticated user', async () => {
  const { app } = createRouterApp();
  await withServer(app, async (baseUrl) => {
    const createRes = await fetch(`${baseUrl}/api/opportunities/follows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: 'destination_cluster',
        slug: 'japan',
        displayName: 'Japan',
        followType: 'radar'
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.item.entity.entity_type, 'destination_cluster');
    assert.equal(created.item.entity.slug, 'japan');

    const listRes = await fetch(`${baseUrl}/api/opportunities/me/follows`);
    assert.equal(listRes.status, 200);
    const listed = await listRes.json();
    assert.equal(Array.isArray(listed.items), true);
    assert.equal(listed.items.length >= 1, true);

    const removeRes = await fetch(`${baseUrl}/api/opportunities/follows/${created.item.id}`, {
      method: 'DELETE'
    });
    assert.equal(removeRes.status, 200);
    const removed = await removeRes.json();
    assert.equal(removed.ok, true);
    assert.equal(removed.removed, true);
  });
});

test('opportunities follows allow re-saving an existing follow when free limit is already reached', async () => {
  const { app } = createRouterApp({
    user: {
      id: 'u-free-cap',
      planType: 'free',
      planStatus: 'active',
      isPremium: false
    }
  });

  const seedSlugs = ['japan', 'spain', 'greece', 'thailand', 'canary-islands'];
  await withServer(app, async (baseUrl) => {
    for (const slug of seedSlugs) {
      const createRes = await fetch(`${baseUrl}/api/opportunities/follows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'destination_cluster',
          slug,
          displayName: slug,
          followType: 'radar'
        })
      });
      assert.equal(createRes.status, 201);
    }

    const duplicateRes = await fetch(`${baseUrl}/api/opportunities/follows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: 'destination_cluster',
        slug: 'japan',
        displayName: 'Japan',
        followType: 'radar'
      })
    });
    assert.equal(duplicateRes.status, 201, 'duplicate follow should update, not be blocked by plan limit');

    const overLimitRes = await fetch(`${baseUrl}/api/opportunities/follows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: 'destination_cluster',
        slug: 'mexico',
        displayName: 'Mexico',
        followType: 'radar'
      })
    });
    assert.equal(overLimitRes.status, 402);
    const body = await overLimitRes.json();
    assert.equal(body.error, 'premium_required');
  });
});

test('radar preferences persist across PUT and GET', async () => {
  const { app } = createRouterApp();
  await withServer(app, async (baseUrl) => {
    const updateRes = await fetch(`${baseUrl}/api/opportunities/radar/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originAirports: ['FCO', 'MXP'],
        favoriteDestinations: ['Tokyo'],
        favoriteCountries: ['Japan'],
        budgetCeiling: 600,
        preferredTravelMonths: [4, 11]
      })
    });
    assert.equal(updateRes.status, 200);
    const updated = await updateRes.json();
    assert.equal(updated.item.originAirports.length, 2);
    assert.equal(updated.item.budgetCeiling, 600);

    const getRes = await fetch(`${baseUrl}/api/opportunities/radar/preferences`);
    assert.equal(getRes.status, 200);
    const loaded = await getRes.json();
    assert.equal(loaded.item.originAirports.includes('FCO'), true);
    assert.equal(loaded.item.favoriteDestinations.includes('Tokyo'), true);
  });
});

test('AI query is gated when user plan is not ELITE', async () => {
  const { app } = createRouterApp({
    user: {
      id: 'u2',
      planType: 'free',
      planStatus: 'active',
      isPremium: false
    }
  });
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/opportunities/ai/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Tokyo da Roma con 500 euro',
        limit: 5
      })
    });
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.error, 'premium_required');
  });
});

test('opportunities explore budget endpoint returns sorted destinations', async () => {
  const { app } = createRouterApp({ optionalAuthEnabled: false });
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/opportunities/explore/budget?origin=FCO&budget_max=1200&limit=10`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.origin, 'FCO');
    assert.equal(Array.isArray(body.items), true);
    assert.equal(body.items.length <= 10, true);
    if (body.items.length > 0) {
      assert.equal(typeof body.items[0].destination_airport, 'string');
      assert.equal(typeof body.items[0].min_price, 'number');
      assert.equal(['one_way', 'round_trip'].includes(String(body.items[0].trip_type || '')), true);
    }
  });
});

test('opportunities explore map endpoint returns points', async () => {
  const { app } = createRouterApp({ optionalAuthEnabled: false });
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/opportunities/explore/map?origin=FCO&budget_max=1200&limit=10`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.origin, 'FCO');
    assert.equal(Array.isArray(body.points), true);
    assert.equal(body.points.length <= 10, true);
    if (body.points.length > 0) {
      assert.equal(typeof body.points[0].destination_airport, 'string');
      assert.equal(body.points[0].origin_coords == null || typeof body.points[0].origin_coords.lat === 'number', true);
    }
  });
});

test('opportunities pipeline endpoints reject non-admin users', async () => {
  const { app } = createRouterApp({
    requireSessionAuth: (_req, _res, next) => next(),
    adminGuard: (_req, res) => res.status(403).json({ error: 'admin_access_denied' })
  });

  await withServer(app, async (baseUrl) => {
    const statusRes = await fetch(`${baseUrl}/api/opportunities/pipeline/status`);
    assert.equal(statusRes.status, 403);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.error, 'admin_access_denied');

    const runRes = await fetch(`${baseUrl}/api/opportunities/pipeline/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(runRes.status, 403);
    const runBody = await runRes.json();
    assert.equal(runBody.error, 'admin_access_denied');
  });
});
