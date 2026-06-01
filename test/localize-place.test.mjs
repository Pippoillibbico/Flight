import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAirportDisplayName,
  formatAirportDisplayNameCompact,
  formatRouteAirportDisplayName,
  formatRouteAirportDisplayNameCompact,
  formatRouteDisplayName,
  hasReadableOfferRouteDisplayName,
  isKnownIataAirportCode,
  localizeClusterDisplayName,
  resolveAirportCityName,
  resolveAirportCityNameForOffer
} from '../src/utils/localizePlace.js';

test('airport labels resolve city names from real IATA airport codes', () => {
  assert.equal(resolveAirportCityName('MXP', 'en'), 'Milan');
  assert.equal(resolveAirportCityName('FCO', 'en'), 'Rome');
  assert.equal(resolveAirportCityName('STN', 'en'), 'London');
  assert.equal(isKnownIataAirportCode('QWE'), false);
  assert.equal(isKnownIataAirportCode('RTY'), true);
  assert.notEqual(resolveAirportCityName('RTY', 'en'), 'Rome');
});

test('airport detail labels show readable airport names with IATA codes', () => {
  assert.equal(formatAirportDisplayName('STN', 'en'), 'London Stansted (STN)');
  assert.equal(formatAirportDisplayName('MXP', 'en'), 'Milan Malpensa (MXP)');
  assert.equal(formatAirportDisplayName('BCN', 'en'), 'Barcelona El Prat (BCN)');
  assert.equal(formatAirportDisplayName('PMO', 'it'), 'Palermo Falcone-Borsellino (PMO)');
  assert.equal(
    formatRouteAirportDisplayName({ origin_airport: 'STN', destination_airport: 'PMO' }, 'en'),
    'London Stansted (STN) -> Palermo Falcone-Borsellino (PMO)'
  );
});

test('card airport detail labels stay compact and avoid raw IATA codes', () => {
  assert.equal(formatAirportDisplayNameCompact('STN', 'en'), 'London Stansted');
  assert.equal(formatAirportDisplayNameCompact('MXP', 'en'), 'Milan Malpensa');
  assert.equal(
    formatRouteAirportDisplayNameCompact({ origin_airport: 'STN', destination_airport: 'PMO' }, 'en'),
    'London Stansted -> Palermo Falcone-Borsellino'
  );
});

test('route display includes readable cities for real airport codes', () => {
  assert.equal(
    formatRouteDisplayName({ origin: 'MXP', destination: 'FCO' }, 'en'),
    'Milan -> Rome'
  );
});

test('offer route display hides raw airport codes in first-level deal cards', () => {
  assert.equal(resolveAirportCityNameForOffer('ETS', 'en'), 'Enterprise');
  assert.equal(resolveAirportCityNameForOffer('EUV', 'en'), '');
  assert.equal(
    formatRouteDisplayName({ origin_airport: 'ETS', destination_airport: 'EUV' }, 'en'),
    'Enterprise'
  );
  assert.equal(
    formatRouteDisplayName({ origin_airport: 'PMO', destination_airport: 'PNF' }, 'it'),
    'Palermo'
  );
  assert.equal(formatRouteDisplayName({ origin_airport: 'IBX', destination_airport: 'IDA' }, 'en'), 'Idaho Falls');
  assert.equal(
    formatRouteDisplayName({ origin_city: 'AXE', destination_city: 'AXV', origin_airport: 'AXE', destination_airport: 'AXV' }, 'en'),
    'Xanxerê -> Wapakoneta'
  );
  assert.equal(hasReadableOfferRouteDisplayName({ origin_airport: 'IBX', destination_airport: 'IDA' }, 'en'), false);
  assert.equal(hasReadableOfferRouteDisplayName({ origin_airport: 'AXE', destination_airport: 'AXV' }, 'en'), true);
  assert.equal(hasReadableOfferRouteDisplayName({ origin_airport: 'FES', destination_airport: 'FFJ' }, 'en'), false);
  assert.equal(localizeClusterDisplayName({ slug: 'qab', cluster_name: 'QAB', destination_airport: 'QAB' }, 'en'), '');
  assert.equal(localizeClusterDisplayName({ slug: 'idaho-falls', cluster_name: 'Idaho Falls', representative_airport: 'IDA' }, 'en'), 'Idaho Falls');
});
