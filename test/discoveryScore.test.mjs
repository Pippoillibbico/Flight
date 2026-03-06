import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalScoreFromPercentiles, confidenceForCount, legacyLevelFromBadge } from '../server/lib/discovery-score.js';

test('confidenceForCount maps sample sizes consistently', () => {
  assert.deepEqual(confidenceForCount(90), { level: 'high', score: 0.95 });
  assert.deepEqual(confidenceForCount(45), { level: 'medium', score: 0.8 });
  assert.deepEqual(confidenceForCount(20), { level: 'low', score: 0.6 });
  assert.deepEqual(confidenceForCount(2), { level: 'very_low', score: 0.35 });
});

test('canonicalScoreFromPercentiles respects badge thresholds and score bounds', () => {
  const steal = canonicalScoreFromPercentiles({
    p10: 100,
    p25: 120,
    p50: 140,
    p75: 180,
    p90: 220,
    observationCount: 120,
    price: 95,
    travelMonth: '2026-05-01'
  });
  const great = canonicalScoreFromPercentiles({
    p10: 100,
    p25: 120,
    p50: 140,
    p75: 180,
    p90: 220,
    observationCount: 50,
    price: 115,
    travelMonth: '2026-05-01'
  });
  const good = canonicalScoreFromPercentiles({
    p10: 100,
    p25: 120,
    p50: 140,
    p75: 180,
    p90: 220,
    observationCount: 18,
    price: 135,
    travelMonth: '2026-05-01'
  });
  const ok = canonicalScoreFromPercentiles({
    p10: 100,
    p25: 120,
    p50: 140,
    p75: 180,
    p90: 220,
    observationCount: 8,
    price: 200,
    travelMonth: '2026-05-01'
  });

  assert.equal(steal.badge, 'STEAL');
  assert.equal(great.badge, 'GREAT');
  assert.equal(good.badge, 'GOOD');
  assert.equal(ok.badge, 'OK');

  for (const item of [steal, great, good, ok]) {
    assert.equal(Number.isInteger(item.score), true);
    assert.equal(item.score >= 0 && item.score <= 100, true);
    assert.equal(Array.isArray(item.reasons), true);
    assert.equal(item.reasons.length >= 3 && item.reasons.length <= 5, true);
  }
});

test('legacyLevelFromBadge keeps backward-compatible mapping', () => {
  assert.equal(legacyLevelFromBadge({ badge: 'STEAL', price: 99, p75: 150 }), 'scream');
  assert.equal(legacyLevelFromBadge({ badge: 'GREAT', price: 110, p75: 150 }), 'great');
  assert.equal(legacyLevelFromBadge({ badge: 'GOOD', price: 130, p75: 150 }), 'good');
  assert.equal(legacyLevelFromBadge({ badge: 'OK', price: 140, p75: 150 }), 'fair');
  assert.equal(legacyLevelFromBadge({ badge: 'OK', price: 180, p75: 150 }), 'bad');
});

