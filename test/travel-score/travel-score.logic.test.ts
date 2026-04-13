import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateTravelScore,
  computeTravelScore,
  computeTravelScoreBounds,
  scoreDurationPenalty,
  scoreItineraries,
  scorePricePenalty,
  scoreStopsPenalty,
  sortByTravelScore,
  sortItinerariesByTravelScore
} from '../../src/features/travel-score/index.ts';

test('travel score gives higher value to better price-duration-stops profile', () => {
  const bounds = {
    minPrice: 120,
    maxPrice: 500,
    minDurationHours: 6,
    maxDurationHours: 18,
    minStops: 0,
    maxStops: 2
  };

  const better = calculateTravelScore(
    {
      price: 160,
      durationHours: 8,
      stopCount: 0
    },
    bounds
  );
  const worse = calculateTravelScore(
    {
      price: 430,
      durationHours: 16,
      stopCount: 2
    },
    bounds
  );

  assert.ok(better > worse);
});

test('travel score calculation is deterministic', () => {
  const bounds = {
    minPrice: 100,
    maxPrice: 900,
    minDurationHours: 4,
    maxDurationHours: 24,
    minStops: 0,
    maxStops: 2
  };
  const itinerary = {
    price: 340,
    durationHours: 11,
    stopCount: 1
  };
  const first = calculateTravelScore(itinerary, bounds);
  const second = calculateTravelScore(itinerary, bounds);
  assert.equal(first, second);
});

test('price/duration/stops penalties are explicit and monotonic', () => {
  const bounds = {
    minPrice: 100,
    maxPrice: 500,
    minDurationHours: 4,
    maxDurationHours: 20,
    minStops: 0,
    maxStops: 2
  };

  assert.ok(scorePricePenalty(150, bounds) < scorePricePenalty(400, bounds));
  assert.ok(scoreDurationPenalty(7, bounds) < scoreDurationPenalty(15, bounds));
  assert.ok(scoreStopsPenalty(0, bounds) < scoreStopsPenalty(2, bounds));
});

test('computeTravelScore normalizes custom weights deterministically', () => {
  const bounds = {
    minPrice: 120,
    maxPrice: 520,
    minDurationHours: 6,
    maxDurationHours: 18,
    minStops: 0,
    maxStops: 2
  };
  const itinerary = { price: 260, durationHours: 10, stopCount: 1 };

  const a = computeTravelScore(itinerary, bounds, { price: 55, duration: 30, stops: 15 });
  const b = computeTravelScore(itinerary, bounds, { price: 11, duration: 6, stops: 3 });
  assert.equal(a, b);
});

test('scoreItineraries adds bounded travelScore for each itinerary', () => {
  const scored = scoreItineraries([
    { id: 'a', price: 190, durationHours: 9, stopCount: 0 },
    { id: 'b', price: 280, durationHours: 13, stopCount: 1 },
    { id: 'c', price: 240, durationHours: 10, stopCount: 2 }
  ]);

  assert.equal(scored.length, 3);
  for (const item of scored) {
    assert.ok(Number.isInteger(item.travelScore));
    assert.ok(item.travelScore >= 0 && item.travelScore <= 100);
  }
});

test('computeTravelScoreBounds supports sparse edge cases', () => {
  const bounds = computeTravelScoreBounds([{ id: 'single' }]);
  assert.ok(Number.isFinite(bounds.minPrice));
  assert.ok(Number.isFinite(bounds.maxPrice));
  assert.ok(Number.isFinite(bounds.minDurationHours));
  assert.ok(Number.isFinite(bounds.maxDurationHours));
  assert.ok(Number.isFinite(bounds.minStops));
  assert.ok(Number.isFinite(bounds.maxStops));
});

test('sortItinerariesByTravelScore sorts by score then price tie-breaker', () => {
  const sorted = sortItinerariesByTravelScore([
    { id: 'a', travelScore: 78, price: 210, savingVs2024: 40 },
    { id: 'b', travelScore: 92, price: 300, savingVs2024: 20 },
    { id: 'c', travelScore: 78, price: 190, savingVs2024: 60 }
  ]);

  assert.deepEqual(
    sorted.map((item) => item.id),
    ['b', 'c', 'a']
  );
});

test('sortByTravelScore aliases sorting logic for explicit domain use', () => {
  const sorted = sortByTravelScore([
    { id: 'x', travelScore: 60, price: 250 },
    { id: 'y', travelScore: 95, price: 400 },
    { id: 'z', travelScore: 60, price: 180 }
  ]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['y', 'z', 'x']
  );
});

test('travel score remains bounded between 0 and 100 for extreme inputs', () => {
  const bounds = {
    minPrice: 100,
    maxPrice: 600,
    minDurationHours: 3,
    maxDurationHours: 20,
    minStops: 0,
    maxStops: 2
  };

  const best = computeTravelScore({ price: 100, durationHours: 3, stopCount: 0 }, bounds);
  const worst = computeTravelScore({ price: 999999, durationHours: 999, stopCount: 9 }, bounds);

  assert.ok(best >= 0 && best <= 100);
  assert.ok(worst >= 0 && worst <= 100);
  assert.ok(best > worst);
});

test('identical itineraries produce stable equal score', () => {
  const scored = scoreItineraries([
    { id: 'a', price: 220, durationHours: 8, stopCount: 1 },
    { id: 'b', price: 220, durationHours: 8, stopCount: 1 },
    { id: 'c', price: 220, durationHours: 8, stopCount: 1 }
  ]);

  const values = scored.map((item) => item.travelScore);
  assert.equal(new Set(values).size, 1);
  assert.ok(Number.isInteger(values[0]));
});

test('sortByTravelScore applies saving tie-breaker when score and price are equal', () => {
  const sorted = sortByTravelScore([
    { id: 'a', travelScore: 80, price: 200, savingVs2024: 20 },
    { id: 'b', travelScore: 80, price: 200, savingVs2024: 60 },
    { id: 'c', travelScore: 80, price: 200, savingVs2024: 40 }
  ]);

  assert.deepEqual(
    sorted.map((item) => item.id),
    ['b', 'c', 'a']
  );
});
