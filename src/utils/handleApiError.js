export function handleApiError(error, { t }) {
  const code = String(error?.code || '').trim();
  const translate = (key, fallback) => {
    if (typeof t !== 'function') return fallback;
    const value = t(key);
    return typeof value === 'string' && value.trim() && value !== key ? value : fallback;
  };

  if (code === 'rate_limited' || code === 'limit_exceeded') {
    const upgradeCtx = String(error?.upgradeContext || error?.upgrade_context || '').trim();
    if (upgradeCtx === 'search_limit') return translate('searchLimitReachedFree', 'Search limit reached.');
    return translate('quotaExceededFriendly', 'You reached your monthly limit.');
  }

  if (code === 'premium_required') {
    return translate('premiumAiRequiredFriendly', 'This feature requires Premium.');
  }

  if (code === 'unauthorized' || code === 'auth_required' || code === 'auth_invalid' || code === 'token_revoked') {
    return translate('sessionExpiredFriendly', 'Session expired. Please sign in again.');
  }

  if (code === 'forbidden') {
    return translate('forbiddenFriendly', "You don't have permission to perform this action.");
  }

  if (code === 'request_timeout') {
    return translate('requestTimeoutFriendly', 'The request is taking too long. Please try again in a moment.');
  }

  if (code === 'request_failed') {
    return translate('requestFailedFriendly', 'Connection temporarily unavailable. Check your network and try again.');
  }

  if (code === 'just_go_round_trip_required') {
    return translate('justGoRoundTripRequired', 'Choose a return date to use this search.');
  }

  if (code === 'just_go_budget_required') {
    return translate('justGoBudgetRequired', 'Enter a maximum budget to use Just Go Mode.');
  }

  if (code === 'live_deals_load_failed') {
    return translate('liveDealsLoadError', 'Unable to load live deals right now.');
  }

  if (code === 'live_deals_save_failed') {
    return translate('liveDealsSaveRouteError', 'Unable to save this route.');
  }

  if (code === 'oauth_signin_failed') {
    return translate('oauthSignInFailed', 'Social sign-in failed. Please try again.');
  }

  return `${translate('genericErrorTitle', 'Not now')}. ${translate('genericErrorSubtext', 'Try again shortly.')}`;
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
