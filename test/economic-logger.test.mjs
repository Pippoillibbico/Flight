import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEconomicEventForStorage } from '../server/lib/economic-logger.js';

test('normalizeEconomicEventForStorage hashes user id and computes margins', () => {
  const event = normalizeEconomicEventForStorage('search_economics', {
    user_id: 'user_123456789',
    user_tier: 'free',
    origin: 'FCO',
    destination: 'JFK',
    revenue_eur: 300,
    provider_cost_eur: 220,
    stripe_fee_eur: 9,
    ai_cost_eur: 0.5
  });

  assert.equal(event.eventType, 'search_economics');
  assert.equal(event.userTier, 'free');
  assert.equal(event.origin, 'FCO');
  assert.equal(event.destination, 'JFK');
  assert.equal(typeof event.userIdHash, 'string');
  assert.equal(event.userIdHash.length, 16);
  assert.equal(event.grossMarginEur, 80);
  assert.equal(event.netMarginEur, 70.5);
});

test('normalizeEconomicEventForStorage keeps unmapped payload in extra and strips raw user ids', () => {
  const event = normalizeEconomicEventForStorage('checkout_created', {
    user_id: 'sensitive_user',
    plan_type: 'pro',
    session_id: 'cs_test_123',
    customer_id: 'cus_test_123',
    price_eur: 12.99
  });

  assert.equal(event.userTier, 'pro');
  assert.equal(event.revenueEur, 12.99);
  assert.equal(event.extra.session_id, 'cs_test_123');
  assert.equal(event.extra.customer_id, 'cus_test_123');
  assert.equal('user_id' in event.extra, false);
});
