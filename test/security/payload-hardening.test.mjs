import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzePayloadShape, createPayloadHardeningMiddleware } from '../../server/middleware/payload-hardening.js';

function mockReq(body, method = 'POST') {
  return { method, body };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('analyzePayloadShape rejects deep payload trees', () => {
  const payload = { a: { b: { c: { d: { e: { f: { g: 'x' } } } } } } };
  const result = analyzePayloadShape(payload, { maxDepth: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'payload_too_deep');
});

test('payload hardening middleware rejects oversized payload', async () => {
  const middleware = createPayloadHardeningMiddleware({
    maxBytes: 1024,
    onReject: (_req, res, reason) => {
      res.status(reason === 'payload_too_large' ? 413 : 400).json({ error: reason });
    }
  });
  const req = mockReq({ message: 'x'.repeat(6000) });
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 413);
  assert.equal(res.body?.error, 'payload_too_large');
});

test('payload hardening middleware allows safe payloads', async () => {
  const middleware = createPayloadHardeningMiddleware({
    maxBytes: 4096,
    maxDepth: 6,
    maxNodes: 80
  });
  const req = mockReq({ email: 'a@example.com', profile: { plan: 'pro' } });
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
