import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateUsageLimit,
  getPlanComparisonRows,
  getPlanEntitlements,
  getUpgradeTriggerContent,
  normalizeUserPlan,
  resolveEffectivePlan
} from '../../src/features/monetization/index.ts';

test('plan normalization and resolution are deterministic', () => {
  assert.equal(normalizeUserPlan('free'), 'free');
  assert.equal(normalizeUserPlan('creator'), 'elite');
  assert.equal(normalizeUserPlan('PRO'), 'pro');
  assert.equal(normalizeUserPlan('unknown'), 'free');

  assert.equal(resolveEffectivePlan('free', 'pro'), 'pro');
  assert.equal(resolveEffectivePlan('elite', 'free'), 'elite');
  assert.equal(resolveEffectivePlan('unknown', 'pro'), 'pro');
});

test('plan entitlements expose expected soft limits', () => {
  const free = getPlanEntitlements('free');
  const pro = getPlanEntitlements('pro');
  const elite = getPlanEntitlements('elite');

  assert.equal(free.trackedRoutesLimit, 3);
  assert.equal(free.savedItinerariesLimit, 3);
  assert.equal(free.aiTravelCandidatesLimit, 3);
  assert.equal(free.radarMessagingTier, 'basic');

  assert.equal(pro.trackedRoutesLimit, 10);
  assert.equal(pro.savedItinerariesLimit, 10);
  assert.equal(pro.aiTravelCandidatesLimit, null);
  assert.equal(pro.radarMessagingTier, 'advanced');

  assert.equal(elite.trackedRoutesLimit, null);
  assert.equal(elite.savedItinerariesLimit, null);
  assert.equal(elite.aiTravelCandidatesLimit, null);
  assert.equal(elite.radarMessagingTier, 'priority');
});

test('usage limit evaluation is stable and bounded', () => {
  const limited = evaluateUsageLimit(3, 3);
  assert.equal(limited.reached, true);
  assert.equal(limited.remaining, 0);

  const partial = evaluateUsageLimit(1, 3);
  assert.equal(partial.reached, false);
  assert.equal(partial.remaining, 2);

  const unlimited = evaluateUsageLimit(100, null);
  assert.equal(unlimited.reached, false);
  assert.equal(unlimited.remaining, null);
});

test('upgrade trigger copy is value-oriented and context specific', () => {
  const tracked = getUpgradeTriggerContent('free', 'tracked_routes_limit', { used: 3, limit: 3 });
  assert.equal(tracked.title, 'Tracking limit reached');
  assert.match(tracked.message, /Track more routes and never miss a drop/i);

  const hotDeal = getUpgradeTriggerContent('pro', 'radar_hot_opened');
  assert.equal(hotDeal.title, 'Get notified when this drops');
  assert.match(hotDeal.message, /priority deal/i);
});

test('plan comparison rows remain explicit and complete', () => {
  const rows = getPlanComparisonRows();
  assert.equal(rows.length, 4);
  assert.equal(rows[0]?.feature, 'Tracked routes');
  assert.equal(rows[0]?.free, 'Up to 3');
  assert.equal(rows[0]?.pro, 'Up to 10');
  assert.equal(rows[0]?.elite, 'Unlimited');
});
