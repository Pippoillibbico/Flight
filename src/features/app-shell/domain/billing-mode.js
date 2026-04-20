export function isMockBillingUpgradeEnabled({ systemCapabilities, isProduction }) {
  if (isProduction) return false;
  return systemCapabilities?.billing_mock_mode === true;
}

