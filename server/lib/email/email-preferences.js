export const EMAIL_TYPES = ['service', 'digest', 'alert', 'marketing'];

export function defaultEmailPreferences() {
  return {
    service: true,
    digest: false,
    alert: false,
    marketing: false,
    updatedAt: null
  };
}

export function normalizeEmailPreferences(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    service: true,
    digest: source.digest === true,
    alert: source.alert === true,
    marketing: source.marketing === true,
    updatedAt: source.updatedAt || null
  };
}

export function canSendEmailType(user, type) {
  const normalizedType = String(type || '').trim().toLowerCase();
  if (normalizedType === 'service') return true;
  const preferences = normalizeEmailPreferences(user?.emailPreferences || user?.email_preferences || {});
  if (normalizedType === 'digest') return preferences.digest === true;
  if (normalizedType === 'alert') return preferences.alert === true;
  if (normalizedType === 'marketing') return preferences.marketing === true;
  return false;
}

export function applyEmailPreferenceUpdate(user, patch = {}, { actor = 'user' } = {}) {
  const current = normalizeEmailPreferences(user?.emailPreferences || {});
  const next = { ...current };
  for (const key of ['digest', 'alert', 'marketing']) {
    if (Object.hasOwn(patch, key)) next[key] = patch[key] === true;
  }
  next.service = true;
  next.updatedAt = new Date().toISOString();
  if (user) {
    user.emailPreferences = next;
    user.emailPreferenceAudit = Array.isArray(user.emailPreferenceAudit) ? user.emailPreferenceAudit : [];
    user.emailPreferenceAudit.push({
      id: `email_pref_${user.emailPreferenceAudit.length + 1}`,
      actor,
      changedAt: next.updatedAt,
      digest: next.digest,
      alert: next.alert,
      marketing: next.marketing
    });
    user.emailPreferenceAudit = user.emailPreferenceAudit.slice(-50);
  }
  return next;
}
