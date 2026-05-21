import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRouteDisplayName, resolveAirportCityName } from '../src/utils/localizePlace.js';

test('airport labels resolve city names for known and internal feed codes', () => {
  assert.equal(resolveAirportCityName('MXP', 'en'), 'Milan');
  assert.equal(resolveAirportCityName('QWE', 'en'), 'Milan');
  assert.equal(resolveAirportCityName('RTY', 'en'), 'Rome');
});

test('route display includes readable cities instead of bare airport codes', () => {
  assert.equal(
    formatRouteDisplayName({ origin: 'QWE', destination: 'RTY' }, 'en'),
    'Milan -> Rome'
  );
});
