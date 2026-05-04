import test from 'node:test';
import assert from 'node:assert/strict';
import { canTrack } from '../../server/lib/consent-service.js';

test('canTrack denies optional tracking when consent is missing', () => {
  assert.equal(canTrack({}, 'analytics'), false);
  assert.equal(canTrack({ userConsent: null }, 'analytics'), false);
  assert.equal(canTrack({ userConsent: { categories: {} } }, 'analytics'), false);
});

test('canTrack allows only necessary by default and respects explicit backend categories', () => {
  assert.equal(canTrack({}, 'necessary'), true);
  assert.equal(canTrack({ userConsent: { categories: { analytics: true } } }, 'analytics'), true);
  assert.equal(canTrack({ userConsent: { categories: { marketing: true } } }, 'analytics'), false);
  assert.equal(canTrack({ userConsent: { categories: { analytics: true } } }, 'unknown_category'), false);
});
