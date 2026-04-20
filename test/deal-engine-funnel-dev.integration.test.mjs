import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { buildDealEngineRouter } from '../server/routes/deal-engine.js';
import { withDb } from '../server/lib/db.js';

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

test('dev funnel helpers expose runtime health and recent telemetry', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  const telemetryProbe = {
    id: `probe_${randomUUID().slice(0, 10)}`,
    at: new Date().toISOString(),
    eventType: 'live_deal_redirect_confirm',
    dealId: `deal_${randomUUID().slice(0, 8)}`,
    routeSlug: 'fco-tyo',
    price: 289,
    sessionId: `sess_${randomUUID().slice(0, 8)}`,
    userId: null,
    source: 'integration_test'
  };

  await withDb((db) => {
    db.clientTelemetryEvents = Array.isArray(db.clientTelemetryEvents) ? db.clientTelemetryEvents : [];
    db.clientTelemetryEvents.push(telemetryProbe);
    return db;
  });

  const app = express();
  app.use(express.json());
  app.use(buildDealEngineRouter());

  await withServer(app, async (baseUrl) => {
    const healthRes = await fetch(`${baseUrl}/api/dev/funnel-health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(Array.isArray(health.providers?.all), true);
    assert.equal(typeof health.realtime?.liveDealsCount, 'number');
    assert.equal(typeof health.cache?.redisConnected, 'boolean');
    assert.equal(typeof health.cache?.source, 'string');
    assert.equal(typeof health.affiliate?.travelpayoutsEnabled, 'boolean');

    const telemetryRes = await fetch(`${baseUrl}/api/dev/last-telemetry?limit=20`);
    assert.equal(telemetryRes.status, 200);
    const telemetry = await telemetryRes.json();
    assert.equal(telemetry.ok, true);
    assert.equal(Array.isArray(telemetry.items), true);
    assert.equal(telemetry.items.some((item) => item.dealId === telemetryProbe.dealId), true);
  });

  if (prevNodeEnv == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
});

test('redirect endpoint tracks click and issues 302 with monetized destination', async () => {
  const app = express();
  app.use(express.json());
  app.use(buildDealEngineRouter());

  await withServer(app, async (baseUrl) => {
    const redirectUrl = `${baseUrl}/api/redirect/deal_test_123?o=FCO&d=TYO&dep=2027-07-14&ret=2027-07-22&prc=289&dt=error_fare&dc=88`;
    const res = await fetch(redirectUrl, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const location = res.headers.get('location') || '';
    assert.equal(location.length > 0, true);
    assert.equal(/^https?:\/\//.test(location), true);
  });
});
