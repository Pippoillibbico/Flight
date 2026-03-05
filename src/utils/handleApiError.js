export function handleApiError(error, { t }) {
  const code = String(error?.code || '').trim();
  const resetAt = String(error?.resetAt || '').trim();

  if (code === 'limit_exceeded') {
    return t('quotaExceededFriendly');
  }

  if (code === 'premium_required') {
    return t('premiumAiRequiredFriendly');
  }

  if (code === 'auth_required' || code === 'auth_invalid' || code === 'token_revoked') {
    return t('sessionExpiredFriendly');
  }

  return `${t('genericErrorTitle')}. ${t('genericErrorSubtext')}`;
}
