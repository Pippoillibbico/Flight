import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalScoreFromPercentiles, confidenceForCount, qualityGateForCount } from '../server/lib/discovery-score.js';

test('discovery score badges and confidence mapping stay stable', () => {
  assert.deepEqual(confidenceForCount(90), { level: 'high', score: 0.95 });
  assert.deepEqual(confidenceForCount(45), { level: 'medium', score: 0.8 });
  assert.deepEqual(confidenceForCount(25), { level: 'low', score: 0.6 });
  assert.deepEqual(confidenceForCount(2), { level: 'very_low', score: 0.35 });
  assert.deepEqual(qualityGateForCount(10), { allowed: false, visibility: 'hidden' });
  assert.deepEqual(qualityGateForCount(30), { allowed: true, visibility: 'low_confidence' });
  assert.deepEqual(qualityGateForCount(40), { allowed: true, visibility: 'normal' });

  const steal = canonicalScoreFromPercentiles({
    p10: 100,
    p25: 130,
    p50: 170,
    p75: 220,
    p90: 280,
    observationCount: 84,
    price: 95,
    travelMonth: '2026-05-01'
  });
  const great = canonicalScoreFromPercentiles({
    p10: 100,
    p25: 130,
    p50: 170,
    p75: 220,
    p90: 280,
    observationCount: 84,
    price: 115,
    travelMonth: '2026-05-01'
  });
  const good = canonicalScoreFromPercentiles({
    p10: 100,
    p25: 130,
    p50: 170,
    p75: 220,
    p90: 280,
    observationCount: 84,
    price: 160,
    travelMonth: '2026-05-01'
  });
  const ok = canonicalScoreFromPercentiles({
    p10: 100,
    p25: 130,
    p50: 170,
    p75: 220,
    p90: 280,
    observationCount: 84,
    price: 260,
    travelMonth: '2026-05-01'
  });

  assert.equal(steal.badge, 'STEAL');
  assert.equal(great.badge, 'GREAT');
  assert.equal(good.badge, 'GOOD');
  assert.equal(ok.badge, 'OK');

  for (const deal of [steal, great, good, ok]) {
    assert.equal(deal.score >= 0 && deal.score <= 100, true);
    assert.equal(Array.isArray(deal.reasons), true);
    assert.equal(deal.reasons.length >= 3 && deal.reasons.length <= 5, true);
  }
});
