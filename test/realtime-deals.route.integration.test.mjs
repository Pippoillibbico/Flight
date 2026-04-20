import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { buildDealEngineRouter } from '../server/routes/deal-engine.js';
import { closeCacheClient } from '../server/lib/free-cache.js';

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

test('realtime deals endpoint returns valid fallback payload when redis is down', async () => {
  const prev = process.env.REDIS_URL;
  try {
    process.env.REDIS_URL = 'redis://127.0.0.1:6399';
    await closeCacheClient();

    const app = express();
    app.use(express.json());
    app.use(buildDealEngineRouter());

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/engine/realtime-deals?limit=5`);
      assert.equal(res.status, 200);
      const body = await res.json();

      assert.equal(Array.isArray(body.deals), true);
      assert.equal(body.deals.length, 0);
      assert.equal(typeof body.meta, 'object');
      assert.equal(body.meta.enabled, true);
      assert.equal(body.meta.redisConnected, false);
      assert.equal(body.meta.source, 'in-memory');
      assert.equal(body.meta.reason, 'no_data');
    });
  } finally {
    await closeCacheClient();
    if (prev == null) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
  }
});
