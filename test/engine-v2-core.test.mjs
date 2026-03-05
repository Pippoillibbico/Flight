import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPriceAnomaly } from '../server/lib/anomaly-detector.js';
import { rankDealV2 } from '../server/lib/deal-ranking-engine.js';
import { findCheapestWindows } from '../server/lib/window-finder-engine.js';

test('anomaly-detector flags strong under-baseline deal', () => {
  const result = detectPriceAnomaly({
    price: 180,
    baselineP50: 300,
    baselineP25: 250,
    baselineP75: 360,
    stopCount: 0,
    isNightFlight: false,
    comfortScore: 82
  });
  assert.equal(result.isDeal, true);
  assert.equal(result.dealDelta >= 0.18 || result.zRobust >= 1.2, true);
});

test('deal-ranking-engine v2 returns bounded confidence and reasons', () => {
  const ranked = rankDealV2({
    dealDelta: 0.27,
    zRobust: 1.8,
    comfortScore: 84,
    seasonalityBonus: 0.2,
    penalties: 0.03,
    riskNote: 'pochi posti, prezzo volatile'
  });
  assert.equal(Number.isInteger(ranked.dealConfidence), true);
  assert.equal(ranked.dealConfidence >= 0 && ranked.dealConfidence <= 100, true);
  assert.equal(Array.isArray(ranked.why), true);
  assert.equal(ranked.why.length >= 3, true);
});

test('window-finder-engine returns deterministic price-first ordering', () => {
  const result = findCheapestWindows({
    origin: 'MXP',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-10',
    stayDays: 5,
    region: 'all',
    travellers: 1,
    cabinClass: 'economy',
    topN: 15
  });
  assert.equal(Array.isArray(result.windows), true);
  assert.equal(result.windows.length > 0, true);
  for (let i = 1; i < result.windows.length; i += 1) {
    const prev = result.windows[i - 1];
    const curr = result.windows[i];
    assert.equal(prev.price <= curr.price, true);
  }
});
