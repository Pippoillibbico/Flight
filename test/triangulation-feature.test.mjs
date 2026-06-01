import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { buildTriangulationRouter } from '../server/features/triangulation/triangulation.routes.js';
import { generateTriangulationCandidates } from '../server/features/triangulation/route-generator.js';
import { classifyTriangulationRisk, scoreTriangulation } from '../server/features/triangulation/route-scorer.js';

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

function buildApp({ planType = 'free', aiRunner, providerSearch, liveEnabled = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/triangulation',
    buildTriangulationRouter({
      authGuard: (req, _res, next) => {
        req.user = { planType };
        next();
      },
      csrfGuard: (_req, _res, next) => next(),
      requireApiScope: () => (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      aiRunner,
      providerSearch,
      liveEnabled,
      limits: { maxBridges: 3, maxCombinations: 8, maxDates: 2, maxResults: 3 }
    })
  );
  return app;
}

const searchPayload = {
  origin: 'ROM',
  destination: 'BKK',
  period: { type: 'month', month: '2026-06' },
  flexibility: 'full_month',
  goal: 'lowest_price',
  maxBridgeStops: 2,
  baggage: 'personal_item',
  riskTolerance: 'medium',
  travellers: 1,
  cabinClass: 'economy'
};

test('FREE triangulation intake returns cached_preview without AI parser calls', async () => {
  let aiCalls = 0;
  let providerCalls = 0;
  const app = buildApp({
    planType: 'free',
    aiRunner: async () => {
      aiCalls += 1;
      throw new Error('AI must not be called for Free');
    },
    providerSearch: async () => {
      providerCalls += 1;
      throw new Error('Provider must not be called for Free');
    }
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/triangulation/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Trovami una triangolazione da Roma a Bangkok a giugno', aiProvider: 'openai' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, 'cached_preview');
    assert.equal(body.paidCostUsed, false);
    assert.equal(body.upgradeRequired, true);
    assert.equal(body.reason, 'triangulation_live_requires_paid_plan');
    assert.equal(body.messageCode, 'TRIANGULATION_LIVE_REQUIRES_PAID_PLAN');
    assert.ok(Array.isArray(body.preview));
    assert.ok(body.preview.every((item) => item.noteCode === 'CACHED_PREVIEW_STATIC'));
    assert.doesNotMatch(JSON.stringify(body), /\b(Strategia|Prezzi non live|Possibile rotta|raggiungere|triangolazione live con|disponibile nei piani|puoi vedere)\b/i);
  });

  assert.equal(aiCalls, 0);
  assert.equal(providerCalls, 0);
});

test('FREE triangulation search returns cached_preview without provider or explainer calls', async () => {
  let aiCalls = 0;
  let providerCalls = 0;
  const app = buildApp({
    planType: 'free',
    aiRunner: async () => {
      aiCalls += 1;
      return 'not allowed';
    },
    providerSearch: async () => {
      providerCalls += 1;
      return { offers: [{ price: 1 }] };
    }
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/triangulation/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchPayload)
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, 'cached_preview');
    assert.equal(body.paidCostUsed, false);
    assert.equal(body.upgradeRequired, true);
    assert.ok(body.preview.every((item) => item.type === 'static_strategy'));
  });

  assert.equal(aiCalls, 0);
  assert.equal(providerCalls, 0);
});

test('PRO intake can use AI parser and returns parsed_live', async () => {
  let aiCalls = 0;
  const app = buildApp({
    planType: 'pro',
    aiRunner: async () => {
      aiCalls += 1;
      return JSON.stringify(searchPayload);
    }
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/triangulation/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Trovami una triangolazione da Roma a Bangkok a giugno', aiProvider: 'openai' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, 'parsed_live');
    assert.equal(body.paidCostUsed, true);
    assert.equal(body.upgradeRequired, false);
    assert.equal(body.parsed.origin, 'ROM');
    assert.equal(body.parsed.destination, 'BKK');
  });

  assert.equal(aiCalls, 1);
});

test('PRO search can use live provider and returns scored triangulation', async () => {
  let providerCalls = 0;
  const prices = new Map([
    ['ROM-BKK', 520],
    ['FCO-BUD', 42],
    ['BUD-BKK', 318],
    ['FCO-ATH', 70],
    ['ATH-BKK', 360],
    ['FCO-VIE', 95],
    ['VIE-BKK', 390]
  ]);
  const app = buildApp({
    planType: 'pro',
    providerSearch: async ({ origin, destination }) => {
      providerCalls += 1;
      return {
        offers: [
          {
            price: prices.get(`${origin}-${destination}`) || prices.get(`ROM-${destination}`) || 400,
            provider: 'mock_provider',
            airline: 'Mock Air'
          }
        ]
      };
    }
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/triangulation/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchPayload)
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, 'live_triangulation');
    assert.equal(body.paidCostUsed, true);
    assert.equal(body.upgradeRequired, false);
    assert.equal(body.baseline.isLive, true);
    assert.ok(body.results.length > 0);
    assert.ok(body.results[0].score >= 0 && body.results[0].score <= 100);
    assert.ok(body.results[0].warnings.some((warning) => warning.includes('Biglietti separati')));
  });

  assert.ok(providerCalls > 0);
});

test('provider failure returns managed live_error response', async () => {
  const rawProviderError = 'provider down: secret-token=should-not-leak';
  const app = buildApp({
    planType: 'pro',
    providerSearch: async () => {
      throw new Error(rawProviderError);
    }
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/triangulation/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchPayload)
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, 'live_error');
    assert.equal(body.reason, 'triangulation_provider_failed');
    assert.equal(body.error, 'TRIANGULATION_PROVIDER_UNAVAILABLE');
    assert.equal(body.message, 'Live triangulation is temporarily unavailable.');
    assert.equal('stack' in body, false);
    assert.doesNotMatch(JSON.stringify(body), /secret-token|should-not-leak|provider down/i);
  });
});

test('scoring handles short layovers, baggage and risk classes', () => {
  assert.equal(classifyTriangulationRisk({ separateTickets: true, layoverHours: 3, baggage: 'personal_item' }), 'high');
  assert.equal(classifyTriangulationRisk({ separateTickets: true, layoverHours: 5, baggage: 'checked' }), 'high');
  const personalItem = scoreTriangulation({ baselinePrice: 520, totalPrice: 360, layoverHours: 7, baggage: 'personal_item' });
  const checked = scoreTriangulation({ baselinePrice: 520, totalPrice: 360, layoverHours: 7, baggage: 'checked' });
  assert.ok(personalItem.score > checked.score);
  assert.ok(['low_medium', 'medium'].includes(personalItem.risk));
  assert.ok(['medium', 'high'].includes(checked.risk));
});

test('route generator respects max combination limit', () => {
  const { candidates, meta } = generateTriangulationCandidates(searchPayload, {
    maxBridges: 20,
    maxDates: 10,
    maxCombinations: 7
  });
  assert.equal(candidates.length, 7);
  assert.equal(meta.limited, true);
});
