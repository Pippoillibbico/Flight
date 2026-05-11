import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildPushRouter } from '../server/routes/push.js';

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

test('push router returns 404 when browser push is not enabled', async () => {
  const app = express();
  app.use('/api/push', buildPushRouter({ enabled: false }));

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/push/vapid-public-key`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'browser_push_not_enabled');
  });
});

test('push router reaches VAPID readiness when browser push is enabled', async () => {
  const app = express();
  app.use('/api/push', buildPushRouter({ enabled: true }));

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/push/vapid-public-key`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'vapid_not_configured');
  });
});
