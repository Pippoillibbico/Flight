import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { z } from 'zod';
import { buildSearchRouter } from '../../server/routes/search.js';
import { createExportRateLimiter, requireExportReason } from '../../server/lib/export-security.js';

function createMockRes() {
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

test('export without reason is rejected with 400', () => {
  const req = { headers: {} };
  const res = createMockRes();
  let called = false;
  requireExportReason({ enforcePrefix: true })(req, res, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, 'Export reason required');
});

test('export with valid reason passes middleware', () => {
  const req = { headers: { 'x-export-reason': 'support_ticket_12345' } };
  const res = createMockRes();
  let called = false;
  requireExportReason({ enforcePrefix: true })(req, res, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(req.exportReason, 'support_ticket_12345');
});

test('export limiter returns 429 on flood', () => {
  const limiter = createExportRateLimiter({ windowMs: 60_000, max: 2 });
  const req = { user: { sub: 'u_1' }, ip: '127.0.0.1' };
  const res1 = createMockRes();
  const res2 = createMockRes();
  const res3 = createMockRes();
  let calls = 0;
  limiter(req, res1, () => {
    calls += 1;
  });
  limiter(req, res2, () => {
    calls += 1;
  });
  limiter(req, res3, () => {
    calls += 1;
  });
  assert.equal(calls, 2);
  assert.equal(res3.statusCode, 429);
  assert.equal(res3.body?.error, 'rate_limited');
});

test('invalid input on /api/search/suggestions is rejected with 400', async () => {
  const app = express();
  app.use('/api', buildSearchRouter({
    ORIGINS: ['FCO'],
    REGION_ENUM: ['all', 'europe'],
    CABIN_ENUM: ['economy'],
    CONNECTION_ENUM: ['all'],
    TRAVEL_TIME_ENUM: ['all'],
    DESTINATIONS: [],
    COUNTRIES: [{ name: 'Italy', officialName: 'Italian Republic', cca2: 'IT', region: 'Europe' }],
    getDestinationSuggestions: () => [],
    searchFlights: async () => ({}),
    decideTrips: () => ({}),
    ensureAiPremiumAccess: () => {},
    enrichDecisionWithAi: async () => ({}),
    parseIntentWithAi: async () => ({}),
    searchSchema: z.object({}),
    justGoSchema: z.object({}),
    decisionIntakeSchema: z.object({}),
    authGuard: (_req, _res, next) => next(),
    csrfGuard: (_req, _res, next) => next(),
    requireApiScope: () => (_req, _res, next) => next(),
    quotaGuard: () => (_req, _res, next) => next(),
    withDb: async (fn) => fn({}),
    insertSearchEvent: async () => {},
    nanoid: () => 'id_1',
    sendMachineError: (_req, res, status, error) => res.status(status).json({ error })
  }));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/suggestions?q=rom&limit=99999`);
    assert.equal(response.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
