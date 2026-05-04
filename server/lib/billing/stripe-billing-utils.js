import { normalizePlanType } from '../plans/normalize-plan-type.js';

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
  const normalized = normalizePlanType(planId);
  return normalized === 'creator' ? 'elite' : normalized;
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

function resolveAllowedFrontendOrigins() {
  const candidates = [
    String(process.env.FRONTEND_ORIGIN || '').trim(),
    String(process.env.FRONTEND_URL || '').trim(),
    ...String(process.env.CORS_ALLOWLIST || '')
      .split(',')
      .map((entry) => entry.trim()),
    ...String(process.env.CORS_ORIGIN || '')
      .split(',')
      .map((entry) => entry.trim())
  ];
  const allowlist = new Set();
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        allowlist.add(parsed.origin);
      }
    } catch {
      continue;
    }
  }
  allowlist.add(resolveFrontendBaseUrl());
  return allowlist;
}

export function resolveAbsoluteUrl(value, fallbackPath) {
  const fallback = `${resolveFrontendBaseUrl()}${fallbackPath}`;
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const allowExternalInProduction = String(process.env.STRIPE_ALLOW_EXTERNAL_RETURN_URLS || '').trim().toLowerCase() === 'true';
  const restrictToAllowlist = isProduction && !allowExternalInProduction;
  const allowedOrigins = restrictToAllowlist ? resolveAllowedFrontendOrigins() : null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
    if (allowedOrigins && !allowedOrigins.has(parsed.origin)) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}
