import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpportunityFeed } from '../server/lib/opportunity-feed-engine.js';
import { ORIGINS } from '../server/data/local-flight-data.js';

test('opportunity feed falls back when origin is not present in local seed data', () => {
  const feed = buildOpportunityFeed({
    origin: 'JFK',
    month: 6,
    limitTotal: 12
  });

  assert.equal(Array.isArray(feed.top), true);
  assert.equal(feed.top.length > 0, true);
  assert.equal(Array.isArray(feed.categories?.cheap_flights), true);
  assert.equal(Array.isArray(feed.categories?.unusual_routes), true);
  assert.equal(Array.isArray(feed.categories?.high_value_deals), true);
  assert.equal(feed.categories.cheap_flights.length > 0, true);
  assert.equal(feed.categories.unusual_routes.length > 0, true);
  assert.equal(feed.categories.high_value_deals.length > 0, true);
  assert.equal(feed.meta.requested_origin, 'JFK');
  assert.equal(feed.meta.origin_fallback_used, true);
});

test('opportunity feed always contains top + core categories for all configured origins/months', () => {
  const origins = ORIGINS.map((item) => item.code);

  for (const origin of origins) {
    for (let month = 1; month <= 12; month += 1) {
      const feed = buildOpportunityFeed({ origin, month });
      const details = `${origin} m${month}`;

      assert.equal(feed.top.length > 0, true, `top empty for ${details}`);
      assert.equal(feed.categories.cheap_flights.length > 0, true, `cheap_flights empty for ${details}`);
      assert.equal(feed.categories.unusual_routes.length > 0, true, `unusual_routes empty for ${details}`);
      assert.equal(feed.categories.high_value_deals.length > 0, true, `high_value_deals empty for ${details}`);
    }
  }
});
