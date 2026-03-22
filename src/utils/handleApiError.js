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

  if (code === 'request_timeout') {
    return 'La richiesta sta impiegando troppo tempo. Riprova tra qualche secondo.';
  }

  if (code === 'request_failed') {
    return 'Connessione temporaneamente non disponibile. Verifica la rete e riprova.';
  }

  return `${t('genericErrorTitle')}. ${t('genericErrorSubtext')}`;
}
