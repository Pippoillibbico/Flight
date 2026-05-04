import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { buildSearchRouter } from '../server/routes/search.js';
import {
  buildFreeAiBlockedPayload,
  FREE_AI_ENABLED,
  getPlanCostLimits,
  isFreeAiFeatureFlagEnabled,
  PLAN_LIMITS
} from '../server/lib/plan-access.js';
import {
  getFreeCostMetrics,
  recordAiCallByPlan,
  recordFreeAiBlocked,
  recordFreeCacheHit,
  recordFreeProviderCallBlocked,
  recordProviderCallByPlan,
  resetFreeCostMetrics
} from '../server/lib/free-cost-metrics.js';

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

test('free plan cost limits disable AI, live provider search and multi-city live scans', () => {
  const free = getPlanCostLimits('free');
  assert.equal(PLAN_LIMITS.free.aiEnabled, false);
  assert.equal(free.aiEnabled, false);
  assert.equal(free.liveProviderSearchEnabled, false);
  assert.equal(free.liveSearchesPerDay, 0);
  assert.equal(free.trackedRoutes, 1);
  assert.equal(free.publicDealsLimit, 10);
  assert.equal(free.radarUsesCachedDataOnly, true);
  assert.equal(free.deepScan, false);
  assert.equal(free.multiCityLive, false);
  assert.equal(free.perUserJobs, false);
  assert.equal(free.priceHistoryDays, 14);
  assert.equal(FREE_AI_ENABLED, false);
  assert.equal(isFreeAiFeatureFlagEnabled({ NODE_ENV: 'production', FREE_AI_ENABLED: 'true' }), false);
});

test('free cost metrics track AI/provider blocks and cache hits by plan', () => {
  resetFreeCostMetrics();
  recordFreeAiBlocked();
  recordFreeProviderCallBlocked();
  recordFreeCacheHit(true);
  recordFreeCacheHit(false);
  recordAiCallByPlan('pro');
  recordProviderCallByPlan('elite');

  const metrics = getFreeCostMetrics();
  assert.equal(metrics.free_ai_blocked, 1);
  assert.equal(metrics.free_provider_call_blocked, 1);
  assert.equal(metrics.free_cache_hit, 1);
  assert.equal(metrics.free_cache_miss, 1);
  assert.equal(metrics.free_cache_hit_rate.hits, 1);
  assert.equal(metrics.free_cache_hit_rate.misses, 1);
  assert.equal(metrics.free_cache_hit_rate.rate, 0.5);
  assert.equal(metrics.ai_calls_by_plan.pro, 1);
  assert.equal(metrics.provider_calls_by_plan.elite, 1);
});

test('free AI block payload is explicit and non-upgrade-bypassable', () => {
  assert.deepEqual(buildFreeAiBlockedPayload(), {
    code: 'AI_NOT_AVAILABLE_ON_FREE',
    error: 'AI_NOT_AVAILABLE_ON_FREE',
    message: 'Free includes public cached deals and basic route insights. AI tools are available on paid plans.',
    upgrade_context: 'ai_travel_limit'
  });
});

test('free multi-city live search is blocked before provider service', async () => {
  resetFreeCostMetrics();
  let liveProviderCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(
    '/api/search',
    buildSearchRouter({
      ORIGINS: [{ code: 'FCO', label: 'Roma Fiumicino (FCO)' }],
      REGION_ENUM: ['all', 'eu'],
      CABIN_ENUM: ['economy'],
      CONNECTION_ENUM: ['all'],
      TRAVEL_TIME_ENUM: ['all'],
      DESTINATIONS: [{ region: 'eu', country: 'Italy' }],
      COUNTRIES: [{ name: 'Italy', officialName: 'Italian Republic', cca2: 'IT', region: 'Europe' }],
      getDestinationSuggestions: () => [],
      searchFlights: () => ({
        flights: [
          {
            origin: 'FCO',
            destinationIata: 'CDG',
            destination: 'Paris',
            price: 120,
            currency: 'EUR'
          }
        ],
        meta: { searchId: 's-free' }
      }),
      decideTrips: () => ({ recommendations: [], meta: {} }),
      ensureAiPremiumAccess: async () => ({ allowed: true }),
      enrichDecisionWithAi: async () => ({ provider: 'none' }),
      parseIntentWithAi: async () => ({ ok: true }),
      searchSchema: {
        safeParse: () => ({
          success: true,
          data: {
            mode: 'multi_city',
            origin: 'FCO',
            destinationQuery: 'CDG',
            dateFrom: '2026-07-01',
            dateTo: '2026-07-08',
            travellers: 1,
            cabinClass: 'economy',
            segments: [
              { origin: 'FCO', destination: 'CDG', date: '2026-07-01' },
              { origin: 'CDG', destination: 'MAD', date: '2026-07-08' }
            ]
          }
        })
      },
      justGoSchema: { safeParse: () => ({ success: true, data: {} }) },
      decisionIntakeSchema: { safeParse: () => ({ success: true, data: {} }) },
      authGuard: (req, _res, next) => {
        req.user = { sub: 'u-free', planType: 'free', authChannel: 'direct' };
        next();
      },
      csrfGuard: (_req, _res, next) => next(),
      requireApiScope: () => (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      withDb: async (fn) => fn({ searches: [] }),
      insertSearchEvent: async () => {},
      nanoid: () => 'id123',
      sendMachineError: (_req, res, status, error, extra = {}) => res.status(status).json({ error, ...extra }),
      liveFlightService: {
        async searchLiveFlights() {
          liveProviderCalls += 1;
          return { offersByDest: {}, meta: {} };
        }
      }
    })
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/search/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiProvider: 'openai' })
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'MULTI_CITY_LIVE_REQUIRES_PRO');
  });

  assert.equal(liveProviderCalls, 0);
  assert.equal(getFreeCostMetrics().free_provider_call_blocked, 1);
});

test('anonymous AI decision request returns 403 and does not call AI provider', async () => {
  resetFreeCostMetrics();
  let aiCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(
    '/api/search',
    buildSearchRouter({
      ORIGINS: [],
      REGION_ENUM: ['all'],
      CABIN_ENUM: ['economy'],
      CONNECTION_ENUM: ['all'],
      TRAVEL_TIME_ENUM: ['all'],
      DESTINATIONS: [],
      COUNTRIES: [],
      getDestinationSuggestions: () => [],
      searchFlights: () => ({ flights: [], meta: {} }),
      decideTrips: () => ({ recommendations: [], meta: {} }),
      ensureAiPremiumAccess: async () => ({ allowed: true }),
      enrichDecisionWithAi: async () => {
        aiCalls += 1;
        return { provider: 'openai' };
      },
      parseIntentWithAi: async () => {
        aiCalls += 1;
        return { ok: true };
      },
      searchSchema: { safeParse: () => ({ success: true, data: {} }) },
      justGoSchema: {
        safeParse: () => ({
          success: true,
          data: {
            origin: 'FCO',
            region: 'all',
            dateFrom: '2026-07-01',
            dateTo: '2026-07-08',
            tripLengthDays: 7,
            budgetMax: 500,
            travellers: 1,
            cabinClass: 'economy',
            mood: 'culture',
            aiProvider: 'openai'
          }
        })
      },
      decisionIntakeSchema: { safeParse: () => ({ success: true, data: { prompt: 'Tokyo', aiProvider: 'openai' } }) },
      authGuard: (_req, res) => res.status(401).json({ error: 'auth_required' }),
      csrfGuard: (_req, _res, next) => next(),
      requireApiScope: () => (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      withDb: async (fn) => fn({ searches: [] }),
      insertSearchEvent: async () => {},
      nanoid: () => 'id123',
      sendMachineError: (_req, res, status, error, extra = {}) => res.status(status).json({ error, ...extra })
    })
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/search/decision/just-go`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiProvider: 'openai' })
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'AI_NOT_AVAILABLE_ON_FREE');
  });

  assert.equal(aiCalls, 0);
  assert.equal(getFreeCostMetrics().free_ai_blocked, 1);
});
