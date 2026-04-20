export function handleApiError(error, { t }) {
  const code = String(error?.code || '').trim();

  if (code === 'rate_limited' || code === 'limit_exceeded') {
    const upgradeCtx = String(error?.upgradeContext || error?.upgrade_context || '').trim();
    if (upgradeCtx === 'search_limit') return t('searchLimitReachedFree');
    return t('quotaExceededFriendly');
  }

  if (code === 'premium_required') {
    return t('premiumAiRequiredFriendly');
  }

  if (code === 'unauthorized' || code === 'auth_required' || code === 'auth_invalid' || code === 'token_revoked') {
    return t('sessionExpiredFriendly');
  }

  if (code === 'forbidden') {
    return t('forbiddenFriendly');
  }

  if (code === 'request_timeout') {
    return t('requestTimeoutFriendly');
  }

  if (code === 'request_failed') {
    return t('requestFailedFriendly');
  }

  return `${t('genericErrorTitle')}. ${t('genericErrorSubtext')}`;
}

/**
 * When an API call returns a 402 premium_required error, extract the
 * upgrade context so the caller can open the upgrade modal with the right
 * plan and source.
 *
 * Returns { planType, source } or null if the error is not a gate error.
 *   planType — 'pro' | 'elite'
 *   source   — the upgrade_context string from the server response
 */
export function extractUpgradeContext(error) {
  const code = String(error?.code || '').trim();
  const context = String(error?.upgradeContext || error?.upgrade_context || '').trim();

  if (code === 'rate_limited' && context) {
    return { planType: 'pro', source: context };
  }

  if (code !== 'premium_required') return null;

  // Contexts that require Elite
  const eliteContexts = new Set([
    'ai_travel_limit',
    'rare_opportunities',
    'smart_alerts_limit',
    'export_limit'
  ]);

  const planType = eliteContexts.has(context) ? 'elite' : 'pro';
  return { planType, source: context || 'premium_gate' };
}
