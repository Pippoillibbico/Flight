import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildDiscoveryRouter } from '../server/routes/discovery.js';

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

function pass(_req, _res, next) {
  next();
}

function passScope() {
  return pass;
}

function passQuota() {
  return pass;
}

test('discovery router exposes feed and inspiration endpoints', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'u_discovery_test' };
    next();
  });
  app.use(
    '/api/discovery',
    buildDiscoveryRouter({
      authGuard: pass,
      csrfGuard: pass,
      requireApiScope: passScope,
      quotaGuard: passQuota
    })
  );

  await withServer(app, async (baseUrl) => {
    const feedRes = await fetch(`${baseUrl}/api/discovery/daily-deals?limit=5`);
    assert.equal(feedRes.status, 200);
    const feed = await feedRes.json();
    assert.equal(Array.isArray(feed.top_offers), true);
    assert.equal(Array.isArray(feed.cheap_flights), true);

    const inspirationRes = await fetch(`${baseUrl}/api/discovery/travel-inspiration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budget: 500,
        climate: 'warm',
        duration: 5,
        origin: 'FCO'
      })
    });
    assert.equal(inspirationRes.status, 200);
    const inspiration = await inspirationRes.json();
    assert.equal(Array.isArray(inspiration.items), true);

    const autoTripRes = await fetch(`${baseUrl}/api/discovery/auto-trip-generator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budget: 800,
        period_from: '2026-08-10',
        duration: 6,
        origin: 'MXP'
      })
    });
    assert.equal(autoTripRes.status, 200);
    const autoTrip = await autoTripRes.json();
    assert.equal(Array.isArray(autoTrip.options), true);
  });
});

test('discovery router supports price drop alerts CRUD', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'u_discovery_alerts_test' };
    next();
  });
  app.use(
    '/api/discovery',
    buildDiscoveryRouter({
      authGuard: pass,
      csrfGuard: pass,
      requireApiScope: passScope,
      quotaGuard: passQuota
    })
  );

  await withServer(app, async (baseUrl) => {
    const createRes = await fetch(`${baseUrl}/api/discovery/price-drop-alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originIata: 'FCO',
        destinationIata: 'JFK',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-20',
        maxPrice: 350,
        channels: {
          push: true,
          email: false,
          in_app: true
        }
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(typeof created.item?.id, 'string');

    const listRes = await fetch(`${baseUrl}/api/discovery/price-drop-alerts`);
    assert.equal(listRes.status, 200);
    const listed = await listRes.json();
    assert.equal(Array.isArray(listed.items), true);
    const found = listed.items.find((item) => item.id === created.item.id);
    assert.equal(Boolean(found), true);

    const deleteRes = await fetch(`${baseUrl}/api/discovery/price-drop-alerts/${created.item.id}`, {
      method: 'DELETE'
    });
    assert.equal(deleteRes.status, 204);
  });
});
