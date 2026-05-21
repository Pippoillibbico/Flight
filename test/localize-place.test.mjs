import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRouteDisplayName, isKnownIataAirportCode, resolveAirportCityName } from '../src/utils/localizePlace.js';

test('airport labels resolve city names from real IATA airport codes', () => {
  assert.equal(resolveAirportCityName('MXP', 'en'), 'Milan');
  assert.equal(resolveAirportCityName('FCO', 'en'), 'Rome');
  assert.equal(isKnownIataAirportCode('QWE'), false);
  assert.equal(isKnownIataAirportCode('RTY'), true);
  assert.notEqual(resolveAirportCityName('RTY', 'en'), 'Rome');
});

test('route display includes readable cities for real airport codes', () => {
  assert.equal(
    formatRouteDisplayName({ origin: 'MXP', destination: 'FCO' }, 'en'),
    'Milan -> Rome'
  );
});
