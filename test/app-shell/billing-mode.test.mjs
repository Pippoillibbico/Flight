import test from 'node:test';
import assert from 'node:assert/strict';
import { isMockBillingUpgradeEnabled } from '../../src/features/app-shell/domain/billing-mode.js';

test('billing mock mode is disabled in production even when capability is true', () => {
  const result = isMockBillingUpgradeEnabled({
    systemCapabilities: { billing_mock_mode: true },
    isProduction: true
  });
  assert.equal(result, false);
});

test('billing mock mode is enabled only when capability is true and environment is not production', () => {
  const enabled = isMockBillingUpgradeEnabled({
    systemCapabilities: { billing_mock_mode: true },
    isProduction: false
  });
  const disabled = isMockBillingUpgradeEnabled({
    systemCapabilities: { billing_mock_mode: false },
    isProduction: false
  });
  assert.equal(enabled, true);
  assert.equal(disabled, false);
});

