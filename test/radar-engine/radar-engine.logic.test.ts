import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RADAR_STATE_THRESHOLDS,
  computeRadarSignals,
  evaluateRadarState,
  sortByRadarPriority
} from '../../src/features/radar-engine/index.ts';

test('computeRadarSignals derives saving percentage from baseline when missing', () => {
  const signals = computeRadarSignals({
    dealLabel: 'good_value',
    dealPriority: 3,
    price: 210,
    avg2024: 300,
    travelScore: 74
  });

  assert.equal(signals.dealLabel, 'good_value');
  assert.equal(signals.dealPriority, 3);
  assert.equal(signals.savingVs2024, 90);
  assert.equal(signals.savingPctVs2024, 30);
  assert.equal(signals.travelScore, 74);
});

test('computeRadarSignals reuses dealSignals payload values when available', () => {
  const signals = computeRadarSignals({
    dealPriority: 3,
    dealSignals: {
      savingVs2024: 120,
      savingPctVs2024: 28.5
    },
    travelScore: 80
  });

  assert.equal(signals.savingVs2024, 120);
  assert.equal(signals.savingPctVs2024, 28.5);
});

test('evaluateRadarState returns radar_hot for top-tier deal priority', () => {
  const result = evaluateRadarState(
    computeRadarSignals({
      dealPriority: RADAR_STATE_THRESHOLDS.hot.minDealPriority,
      travelScore: 70,
      savingPctVs2024: 10
    })
  );

  assert.equal(result.state, 'radar_hot');
  assert.equal(result.reason, 'Top-tier deal signal');
});

test('evaluateRadarState returns radar_hot for strong score and saving', () => {
  const result = evaluateRadarState(
    computeRadarSignals({
      dealPriority: 2,
      travelScore: RADAR_STATE_THRESHOLDS.hot.minTravelScore,
      savingPctVs2024: RADAR_STATE_THRESHOLDS.hot.minSavingPct
    })
  );

  assert.equal(result.state, 'radar_hot');
  assert.equal(result.reason, 'High score with strong saving');
});

test('evaluateRadarState returns radar_watch for moderate deal priority', () => {
  const result = evaluateRadarState(
    computeRadarSignals({
      dealPriority: RADAR_STATE_THRESHOLDS.watch.minDealPriority,
      travelScore: 58,
      savingPctVs2024: 4
    })
  );

  assert.equal(result.state, 'radar_watch');
  assert.equal(result.reason, 'Worth watching for value trend');
});

test('evaluateRadarState returns radar_watch for moderate score and saving', () => {
  const result = evaluateRadarState(
    computeRadarSignals({
      dealPriority: 2,
      travelScore: RADAR_STATE_THRESHOLDS.watch.minTravelScore,
      savingPctVs2024: RADAR_STATE_THRESHOLDS.watch.minSavingPct
    })
  );

  assert.equal(result.state, 'radar_watch');
  assert.equal(result.reason, 'Moderate score with positive saving');
});

test('evaluateRadarState returns radar_none for low upside', () => {
  const result = evaluateRadarState(
    computeRadarSignals({
      dealPriority: 1,
      travelScore: 48,
      savingPctVs2024: 1
    })
  );

  assert.equal(result.state, 'radar_none');
  assert.equal(result.reason, 'Low upside right now');
});

test('sortByRadarPriority orders hot then watch then none deterministically', () => {
  const sorted = sortByRadarPriority([
    { id: 'none-a', dealPriority: 2, travelScore: 49, savingPctVs2024: 2, price: 150 },
    { id: 'watch-a', dealPriority: 3, travelScore: 65, savingPctVs2024: 5, price: 300 },
    { id: 'hot-a', dealPriority: 4, travelScore: 72, savingPctVs2024: 12, price: 420 },
    { id: 'watch-b', dealPriority: 3, travelScore: 78, savingPctVs2024: 15, price: 280 }
  ]);

  assert.deepEqual(
    sorted.map((entry) => entry.id),
    ['hot-a', 'watch-b', 'watch-a', 'none-a']
  );
});

