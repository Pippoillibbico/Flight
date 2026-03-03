import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotaGuard } from '../server/middleware/quotaGuard.js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name] = value;
    },
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

test('quotaGuard allows request and sets quota headers', async () => {
  const guard = createQuotaGuard({
    cost: { counter: 'search', amount: 1 },
    checkQuota: async () => ({
      allowed: true,
      counter: 'search',
      used: 2,
      limit: 10,
      remaining: 8,
      resetAt: '2026-04-01T00:00:00.000Z'
    })
  });

  const req = { user: { sub: 'u1' }, path: '/api/search', method: 'POST', ip: '127.0.0.1', id: 'r1' };
  const res = mockRes();
  let nextCalled = false;
  await guard(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['X-Quota-Counter'], 'search');
  assert.equal(res.headers['X-Quota-Limit'], '10');
});

test('quotaGuard blocks when limit exceeded', async () => {
  const guard = createQuotaGuard({
    cost: { counter: 'alerts', amount: 1 },
    checkQuota: async () => ({
      allowed: false,
      counter: 'alerts',
      resetAt: '2026-04-01T00:00:00.000Z'
    })
  });
  const req = { user: { sub: 'u1' }, path: '/api/alerts', method: 'POST', ip: '127.0.0.1', id: 'r2' };
  const res = mockRes();
  let nextCalled = false;
  await guard(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body?.error, 'limit_exceeded');
});

test('quotaGuard is non-fatal in non-production on checker error', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const guard = createQuotaGuard({
    checkQuota: async () => {
      throw new Error('store down');
    },
    warn: () => {}
  });
  const req = { user: { sub: 'u1' }, path: '/api/search', method: 'POST', ip: '127.0.0.1', id: 'r3' };
  const res = mockRes();
  let nextCalled = false;
  await guard(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  process.env.NODE_ENV = previous;
});

