import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPublicDiscoveryOpportunity,
  publicDiscoveryRelevanceScore
} from '../server/lib/opportunity-store.js';

test('public discovery excludes opportunities created by unit tests', () => {
  assert.equal(isPublicDiscoveryOpportunity({ airline: 'unit_test_airline', origin_airport: 'FCO', destination_airport: 'LIS' }), false);
  assert.equal(isPublicDiscoveryOpportunity({ airline: 'partner_feed_a', origin_airport: 'FCO', destination_airport: 'LIS' }), true);
  assert.equal(isPublicDiscoveryOpportunity({ airline: 'partner_feed_a', origin_airport: 'RQJ', destination_airport: 'RRA' }), false);
  assert.equal(isPublicDiscoveryOpportunity({}), false);
});

test('public discovery prioritizes curated useful routes over unfamiliar global routes', () => {
  const curated = publicDiscoveryRelevanceScore({ origin_airport: 'FCO', destination_airport: 'LIS' });
  const unfamiliar = publicDiscoveryRelevanceScore({ origin_airport: 'KAU', destination_airport: 'KBL' });
  assert.equal(curated > unfamiliar, true);
});
