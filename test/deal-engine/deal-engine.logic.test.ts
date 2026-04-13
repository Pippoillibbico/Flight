import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEAL_VALUE_THRESHOLDS,
  classifyDealValue,
  computeDealSignals,
  sortByDealPriority
} from '../../src/features/deal-engine/index.ts';

test('computeDealSignals derives saving and percentage from price and avg2024', () => {
  const signals = computeDealSignals({
    price: 200,
    avg2024: 320,
    travelScore: 78
  });

  assert.equal(signals.price, 200);
  assert.equal(signals.avg2024, 320);
  assert.equal(signals.savingVs2024, 120);
  assert.equal(signals.savingPctVs2024, 37.5);
  assert.equal(signals.travelScore, 78);
});

test('computeDealSignals prefers explicit savingVs2024 when provided', () => {
  const signals = computeDealSignals({
    price: 200,
    avg2024: 320,
    savingVs2024: 90,
    travelScore: 64
  });

  assert.equal(signals.savingVs2024, 90);
  assert.equal(signals.savingPctVs2024, 28.1);
});

test('classifyDealValue returns great_deal on strong saving and solid score', () => {
  const result = classifyDealValue(
    computeDealSignals({
      price: 180,
      avg2024: 360,
      travelScore: DEAL_VALUE_THRESHOLDS.greatDeal.minTravelScore
    })
  );

  assert.equal(result.label, 'great_deal');
  assert.equal(result.reason, 'High score and strong saving');
});

test('classifyDealValue returns good_value on moderate saving and score', () => {
  const result = classifyDealValue(
    computeDealSignals({
      price: 250,
      avg2024: 320,
      travelScore: DEAL_VALUE_THRESHOLDS.goodValue.minTravelScore
    })
  );

  assert.equal(result.label, 'good_value');
  assert.equal(result.reason, 'Solid score with good saving');
});

test('classifyDealValue returns fair_price when saving is low', () => {
  const result = classifyDealValue(
    computeDealSignals({
      price: 300,
      avg2024: 320,
      travelScore: 70
    })
  );

  assert.equal(result.label, 'fair_price');
  assert.equal(result.reason, 'Low saving for current price');
});

test('classifyDealValue returns overpriced when current price exceeds baseline', () => {
  const result = classifyDealValue(
    computeDealSignals({
      price: 390,
      avg2024: 350,
      travelScore: 62
    })
  );

  assert.equal(result.label, 'overpriced');
  assert.equal(result.reason, 'Current price is above 2024 baseline');
});

test('classifyDealValue returns overpriced on low score without strong savings', () => {
  const result = classifyDealValue(
    computeDealSignals({
      price: 240,
      avg2024: 250,
      travelScore: 42
    })
  );

  assert.equal(result.label, 'overpriced');
  assert.equal(result.reason, 'Low score for current price');
});

test('sortByDealPriority orders by label priority then score/saving/price tie-breakers', () => {
  const sorted = sortByDealPriority([
    { id: 'fair-a', price: 300, avg2024: 320, travelScore: 68 },
    { id: 'good-b', price: 250, avg2024: 320, travelScore: 72 },
    { id: 'over-c', price: 390, avg2024: 350, travelScore: 40 },
    { id: 'great-d', price: 180, avg2024: 360, travelScore: 90 },
    { id: 'good-e', price: 260, avg2024: 330, travelScore: 78 }
  ]);

  assert.deepEqual(
    sorted.map((item) => item.id),
    ['great-d', 'good-e', 'good-b', 'fair-a', 'over-c']
  );
});

