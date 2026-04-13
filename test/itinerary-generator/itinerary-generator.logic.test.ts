import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeItineraryGenerationSignals,
  explainGeneratedItinerary,
  generateCandidateItineraries,
  rankGeneratedItineraries
} from '../../src/features/itinerary-generator/index.ts';

function baseInputs() {
  return [
    {
      id: 'a',
      sourceType: 'search_result' as const,
      origin: 'FCO',
      destination: 'Lisbon',
      destinationIata: 'LIS',
      price: 180,
      durationHours: 6,
      stopCount: 0,
      comfortScore: 88,
      travelScore: 90,
      dealPriority: 4,
      radarPriority: 3,
      viewItineraryId: 'a'
    },
    {
      id: 'b',
      sourceType: 'search_result' as const,
      origin: 'FCO',
      destination: 'Athens',
      destinationIata: 'ATH',
      price: 260,
      durationHours: 8,
      stopCount: 0,
      comfortScore: 80,
      travelScore: 78,
      dealPriority: 3,
      radarPriority: 2,
      viewItineraryId: 'b'
    },
    {
      id: 'c',
      sourceType: 'search_result' as const,
      origin: 'FCO',
      destination: 'Tokyo',
      destinationIata: 'TYO',
      price: 390,
      durationHours: 14,
      stopCount: 2,
      comfortScore: 45,
      travelScore: 52,
      dealPriority: 1,
      radarPriority: 1,
      viewItineraryId: 'c'
    }
  ];
}

test('computeItineraryGenerationSignals is deterministic and bounded', () => {
  const preferences = {
    maxBudget: 300,
    maxStops: 1,
    comfortPreference: 'balanced' as const
  };
  const inputs = baseInputs();
  const firstInput = inputs[0];
  assert.ok(firstInput, 'expected first input fixture');
  const first = computeItineraryGenerationSignals(firstInput, preferences);
  const second = computeItineraryGenerationSignals(firstInput, preferences);

  assert.deepEqual(first, second);
  assert.ok(first.travelScoreNorm >= 0 && first.travelScoreNorm <= 100);
  assert.ok(first.budgetFitScore >= 0 && first.budgetFitScore <= 100);
  assert.ok(first.stopsFitScore >= 0 && first.stopsFitScore <= 100);
});

test('generateCandidateItineraries respects structured origin and maxStops filters', () => {
  const generated = generateCandidateItineraries(baseInputs(), {
    origin: 'FCO',
    maxStops: 0,
    multiCityEnabled: false
  });

  assert.ok(generated.length > 0);
  assert.ok(generated.every((item) => item.origin === 'FCO'));
  assert.ok(generated.every((item) => item.stopCount === null || item.stopCount <= 0));
  assert.ok(generated.every((item) => item.itineraryType === 'single'));
});

test('generateCandidateItineraries can compose deterministic multi-city candidates when enabled', () => {
  const generated = generateCandidateItineraries(baseInputs(), {
    origin: 'FCO',
    multiCityEnabled: true
  });
  const multiCity = generated.filter((item) => item.itineraryType === 'multi_city');

  assert.ok(multiCity.length > 0);
  assert.ok(multiCity[0]?.candidateId.startsWith('multi:'));
  assert.equal(multiCity[0]?.sourceIds.length, 2);
});

test('rankGeneratedItineraries produces stable ordering for same fixture data', () => {
  const generated = generateCandidateItineraries(baseInputs(), {
    origin: 'FCO',
    multiCityEnabled: false,
    limit: 3
  });
  const firstRun = rankGeneratedItineraries(generated, {
    maxBudget: 320,
    maxStops: 1,
    budgetSensitivity: 'balanced',
    valuePreference: 'value_focus',
    limit: 3
  });
  const secondRun = rankGeneratedItineraries(generated, {
    maxBudget: 320,
    maxStops: 1,
    budgetSensitivity: 'balanced',
    valuePreference: 'value_focus',
    limit: 3
  });

  assert.deepEqual(
    firstRun.map((item) => item.candidateId),
    secondRun.map((item) => item.candidateId)
  );
  assert.ok(Number(firstRun[0]?.rankingScore) >= Number(firstRun[firstRun.length - 1]?.rankingScore));
});

test('explainGeneratedItinerary returns short deterministic explanations', () => {
  const generated = generateCandidateItineraries(baseInputs(), { multiCityEnabled: false });
  const ranked = rankGeneratedItineraries(generated, {
    maxBudget: 300,
    maxStops: 1,
    valuePreference: 'value_focus'
  });
  const top = ranked[0];
  assert.ok(top, 'expected ranked candidate');
  const explanation = explainGeneratedItinerary(top, {
    maxBudget: 300,
    maxStops: 1,
    valuePreference: 'value_focus'
  });

  assert.ok(typeof explanation === 'string' && explanation.length > 8);
  assert.ok(!/\n/.test(explanation));
});

test('generator handles empty input safely', () => {
  const generated = generateCandidateItineraries([], { multiCityEnabled: true });
  const ranked = rankGeneratedItineraries(generated, { limit: 5 });

  assert.deepEqual(generated, []);
  assert.deepEqual(ranked, []);
});
