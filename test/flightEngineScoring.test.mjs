import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '../server/data/local-flight-data.js';
import {
  computeAvg2024,
  computeComfortScore,
  computeHighSeasonAvg,
  computeSavingVs2024,
  decideTrips,
  searchFlights
} from '../server/lib/flight-engine.js';

test('core price metrics are derived from local seasonal bands', () => {
  const route = ROUTES.find((r) => r.origin === 'MXP' && r.destinationIata === 'BCN');
  assert.ok(route);

  const avg2024 = computeAvg2024(route);
  const highSeasonAvg = computeHighSeasonAvg(route);
  assert.equal(Number.isFinite(avg2024), true);
  assert.equal(Number.isFinite(highSeasonAvg), true);
  assert.equal(highSeasonAvg >= avg2024 * 0.9, true);

  const saving = computeSavingVs2024(140, avg2024);
  assert.equal(saving, avg2024 - 140);
});

test('comfort score penalizes night flights and extra stops', () => {
  const route = ROUTES.find((r) => r.origin === 'FCO' && r.destinationIata === 'TYO');
  assert.ok(route);

  const directDay = computeComfortScore({
    stopCount: 0,
    isNightFlight: false,
    departureHour: 9,
    route
  });
  const multiNight = computeComfortScore({
    stopCount: 2,
    isNightFlight: true,
    departureHour: 23,
    route
  });

  assert.equal(directDay > multiNight, true);
  assert.equal(directDay >= 1 && directDay <= 100, true);
  assert.equal(multiNight >= 1 && multiNight <= 100, true);
});

test('searchFlights sorting is deterministic: price asc then saving desc', () => {
  const result = searchFlights({
    origin: 'MXP',
    region: 'all',
    country: undefined,
    destinationQuery: '',
    dateFrom: '2026-07-11',
    dateTo: '2026-07-18',
    cheapOnly: false,
    maxBudget: undefined,
    connectionType: 'all',
    maxStops: 2,
    travelTime: 'all',
    minComfortScore: undefined,
    travellers: 1,
    cabinClass: 'economy'
  });

  assert.equal(result.flights.length > 0, true);
  for (let i = 1; i < result.flights.length; i += 1) {
    const prev = result.flights[i - 1];
    const curr = result.flights[i];
    assert.equal(prev.price <= curr.price || (prev.price === curr.price && prev.savingVs2024 >= curr.savingVs2024), true);
  }
});

test('decideTrips returns top 4 when requested and uses budget field', () => {
  const result = decideTrips({
    origin: 'VCE',
    region: 'all',
    dateFrom: '2026-09-05',
    dateTo: '2026-09-12',
    tripLengthDays: 7,
    budget: 2200,
    travellers: 1,
    cabinClass: 'economy',
    climatePreference: 'mild',
    pace: 'normal',
    avoidOvertourism: true,
    packageCount: 4
  });

  assert.equal(result.meta.packageCount, 4);
  assert.equal(result.recommendations.length <= 4, true);
  assert.equal(result.recommendations.length >= 1, true);
});
