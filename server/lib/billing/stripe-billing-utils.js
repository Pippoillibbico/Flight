export function normalizeSubscriptionStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (status === 'active') return 'active';
  if (status === 'canceled' || status === 'cancelled' || status === 'expired') return 'canceled';
  if (status === 'past due') return 'past_due';
  return status || 'active';
}

export function normalizeStripeProrationBehavior(rawValue, fallback = 'create_prorations') {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (normalized === 'none') return 'none';
  if (normalized === 'create_prorations') return 'create_prorations';
  if (normalized === 'always_invoice') return 'always_invoice';
  return fallback;
}

export function planIdToPublicPlanType(planId) {
  const normalized = String(planId || '').trim().toLowerCase();
  if (normalized === 'creator') return 'elite';
  if (normalized === 'pro') return 'pro';
  return 'free';
}

export function resolveFrontendBaseUrl() {
  const candidates = [
    String(process.env.FRONTEND_ORIGIN || '').trim(),
    String(process.env.FRONTEND_URL || '').trim(),
    'http://localhost:5173'
  ];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      continue;
    }
  }
  return 'http://localhost:5173';
}

export function resolveAbsoluteUrl(value, fallbackPath) {
  const fallback = `${resolveFrontendBaseUrl()}${fallbackPath}`;
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}
