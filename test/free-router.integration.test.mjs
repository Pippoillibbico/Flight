import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { buildBasicRouteInsight, buildFreeRouter } from '../server/routes/free.js';
import { getFreeCostMetrics, resetFreeCostMetrics } from '../server/lib/free-cost-metrics.js';

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

function createApp(listDeals) {
  const app = express();
  app.use(express.json());
  app.use('/api/free', buildFreeRouter({ listDeals }));
  return app;
}

test('GET /api/free/public-deals returns at most 10 cached public deals', async () => {
  resetFreeCostMetrics();
  let providerCalls = 0;
  const app = createApp(async () => {
    providerCalls += 0;
    return Array.from({ length: 12 }, (_, index) => ({
      id: `deal-${index}`,
      origin_airport: 'ROM',
      destination_airport: index === 0 ? 'TYO' : 'LIS',
      destination_city: index === 0 ? 'Tokyo' : 'Lisbon',
      price: 120 + index,
      currency: 'EUR',
      baseline_price: 180,
      source_observed_at: '2026-05-01T10:00:00.000Z'
    }));
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/free/public-deals?limit=10`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.dataSource, 'cached_public_scan');
    assert.equal(body.cachedOnly, true);
    assert.equal(body.aiUsed, false);
    assert.equal(body.liveProviderUsed, false);
    assert.equal(body.items.length, 10);
    assert.equal(body.lastScannedAt, '2026-05-01T10:00:00.000Z');
  });

  assert.equal(providerCalls, 0);
  assert.equal(getFreeCostMetrics().free_cache_hit, 1);
});

test('GET /api/free/public-deals falls back to declared demo snapshot on cache miss', async () => {
  resetFreeCostMetrics();
  const app = createApp(async () => []);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/free/public-deals`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.dataSource, 'demo_snapshot');
    assert.equal(body.cachedOnly, true);
    assert.equal(body.items.length > 0, true);
  });

  assert.equal(getFreeCostMetrics().free_cache_miss, 1);
});

test('GET /api/free/route-insight uses cached route data and deterministic templates', async () => {
  resetFreeCostMetrics();
  const app = createApp(async ({ originAirport }) => {
    assert.equal(originAirport, 'ROM');
    return [
      {
        id: 'route-rom-tyo',
        origin_airport: 'ROM',
        destination_airport: 'TYO',
        price: 600,
        baseline_price: 800,
        source_observed_at: '2026-05-01T10:00:00.000Z'
      }
    ];
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/free/route-insight?from=ROM&to=TYO`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'interesting');
    assert.equal(body.message, 'This route is currently below its recent public baseline.');
    assert.equal(body.dataSource, 'cached_public_scan');
    assert.equal(body.cachedPrice, 600);
    assert.equal(body.savingPercent, 25);
  });
});

test('GET /api/free/route-insight validates input and never invents live data', async () => {
  const app = createApp(async () => []);

  await withServer(app, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/free/route-insight?from=ROME&to=TYO`);
    assert.equal(invalid.status, 400);

    const miss = await fetch(`${baseUrl}/api/free/route-insight?from=ROM&to=TYO`);
    assert.equal(miss.status, 200);
    const body = await miss.json();
    assert.equal(body.status, 'no_recent_public_data');
    assert.equal(body.dataSource, 'cached_only');
    assert.equal(body.cachedPrice, null);
  });
});

test('POST /api/free/radar/refresh blocks live refresh and records cost guard metrics', async () => {
  resetFreeCostMetrics();
  const app = createApp(async () => []);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/free/radar/refresh`, { method: 'POST' });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'LIVE_REFRESH_REQUIRES_PRO');
  });

  const metrics = getFreeCostMetrics();
  assert.equal(metrics.free_provider_call_blocked, 1);
  assert.equal(metrics.free_upgrade_prompt_shown, 1);
});

test('buildBasicRouteInsight has deterministic no-AI outputs', () => {
  assert.deepEqual(buildBasicRouteInsight(null), {
    status: 'no_recent_public_data',
    message: 'We do not have recent public cached data for this route yet. Pro unlocks live scans and alerts.',
    dataSource: 'cached_only'
  });
});
