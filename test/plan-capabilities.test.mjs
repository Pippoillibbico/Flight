import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAID_CAPABILITIES,
  buildCapabilityAllowedPayload,
  buildCapabilityBlockedPayload,
  canUsePaidCapability,
  getCapabilityMode,
  listAllowedCapabilities
} from '../server/lib/plan-capabilities.js';

test('FREE plan cannot use any paid variable-cost capability', () => {
  for (const capability of PAID_CAPABILITIES) {
    assert.equal(canUsePaidCapability('free', capability), false, capability);
    const payload = buildCapabilityBlockedPayload('free', capability);
    assert.equal(payload.mode, 'cached_preview');
    assert.equal(payload.paidCostUsed, false);
    assert.equal(payload.upgradeRequired, true);
    assert.ok(payload.reason.endsWith('_requires_paid_plan'));
    assert.deepEqual(payload.allowedCapabilities, ['cached_preview', 'static_recommendations', 'local_search']);
  }
});

test('PRO can use live capabilities and CREATOR alias maps to elite power capabilities', () => {
  for (const capability of PAID_CAPABILITIES) {
    assert.equal(canUsePaidCapability('pro', capability), true, capability);
    assert.equal(buildCapabilityAllowedPayload('pro', capability).upgradeRequired, false);
  }

  assert.equal(canUsePaidCapability('creator', 'advanced_automations'), true);
  assert.equal(canUsePaidCapability('creator', 'advanced_alerts'), true);
  assert.equal(canUsePaidCapability('creator', 'triangulation_monitoring'), true);
});

test('capability modes distinguish live, live triangulation, and safe free modes', () => {
  assert.equal(getCapabilityMode('free', 'provider_live'), 'cached_preview');
  assert.equal(getCapabilityMode('pro', 'provider_live'), 'live');
  assert.equal(getCapabilityMode('pro', 'triangulation_live'), 'live_triangulation');
  assert.deepEqual(listAllowedCapabilities('free'), ['cached_preview', 'static_recommendations', 'local_search']);
});
