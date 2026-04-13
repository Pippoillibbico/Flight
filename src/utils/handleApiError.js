export function handleApiError(error, { t }) {
  const code = String(error?.code || '').trim();
  const resetAt = String(error?.resetAt || '').trim();

  if (code === 'rate_limited' || code === 'limit_exceeded') {
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
