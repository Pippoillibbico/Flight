const PLAN_TYPES = ['free', 'pro', 'elite'];
const PLAN_STATUS = ['active', 'past_due', 'canceled'];

// ── Per-plan feature limits (active entity counts, not monthly quotas) ────────
export const PLAN_LIMITS = {
  free:  { maxFollows: 5,  maxRadarOrigins: 0,  maxSavedSearches: 3  },
  pro:   { maxFollows: 50, maxRadarOrigins: 3,  maxSavedSearches: 20 },
  elite: { maxFollows: null, maxRadarOrigins: null, maxSavedSearches: null }
};

// ── Runtime economic limits per plan (Redis rate-limit + provider cost control) ─
// These are the authoritative per-request/per-day constraints used by:
//   - quotaGuard (search rate limiting)
//   - search route (live-provider fan-out)
//   - ai-cost-guard (per-plan AI token budget)
// 'elite' is the canonical id for the Creator plan internally.
export const PLAN_RUNTIME_LIMITS = {
  free: {
    searchPerDay:      10,  searchPerMin:     2,
    sessionPerDay:     10,  sessionPerMin:    2,
    liveDestinations:   0,  cacheOnly:        true,
    aiEnabled:         false,
    aiCallsPerDay:      0,  aiTokensPerMonth: 0
  },
  pro: {
    searchPerDay:      40,  searchPerMin:     5,
    sessionPerDay:     30,  sessionPerMin:    4,
    liveDestinations:   3,  cacheOnly:        false,
    aiEnabled:         false,
    aiCallsPerDay:      0,  aiTokensPerMonth: 0
  },
  elite: {
    searchPerDay:     100,  searchPerMin:    10,
    sessionPerDay:     60,  sessionPerMin:    8,
    liveDestinations:   4,  cacheOnly:        false,
    aiEnabled:         true,
    aiCallsPerDay:      8,  aiTokensPerMonth: 200_000
  }
};

// Resolve PLAN_RUNTIME_LIMITS for a raw plan type string (accepts 'creator' alias).
export function getPlanRuntimeLimits(planTypeRaw) {
  const key = normalizePlanType(planTypeRaw, false);
  return PLAN_RUNTIME_LIMITS[key] || PLAN_RUNTIME_LIMITS.free;
}

export function normalizePlanType(value, fallbackPremium = false) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'creator') return 'elite';
  if (PLAN_TYPES.includes(raw)) return raw;
  return fallbackPremium ? 'pro' : 'free';
}

export function normalizePlanStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (PLAN_STATUS.includes(raw)) return raw;
  return 'active';
}

export function resolveUserPlan(user) {
  const planType = normalizePlanType(user?.planType || user?.plan_type, Boolean(user?.isPremium));
  const planStatus = normalizePlanStatus(user?.planStatus || user?.plan_status);
  return { planType, planStatus };
}

export function canViewUnlimitedOpportunities(user) {
  const { planType } = resolveUserPlan(user);
  return planType === 'pro' || planType === 'elite';
}

export function canUseRadar(user) {
  return canViewUnlimitedOpportunities(user);
}

export function canUseAITravel(user) {
  const { planType } = resolveUserPlan(user);
  return planType === 'elite';
}

export function canViewRareOpportunities(user) {
  const { planType } = resolveUserPlan(user);
  return planType === 'elite';
}

export function canAccessForecast(user) {
  const { planType } = resolveUserPlan(user);
  return planType === 'pro' || planType === 'elite';
}

// ── Feature access helpers ────────────────────────────────────────────────────

/**
 * Returns the maximum number of active follows a user may have,
 * or null for unlimited (elite).
 */
export function getFollowsLimit(user) {
  const { planType } = resolveUserPlan(user);
  const limits = PLAN_LIMITS[planType];
  // null = unlimited (elite); undefined plan falls back to free cap
  if (!limits) return PLAN_LIMITS.free.maxFollows;
  return limits.maxFollows;
}

/**
 * Returns max radar origin airports the user can configure,
 * or null for unlimited.
 */
export function getRadarOriginsLimit(user) {
  const { planType } = resolveUserPlan(user);
  const limits = PLAN_LIMITS[planType];
  if (!limits) return 0;
  return limits.maxRadarOrigins;
}

/** Pro and Elite users can configure radar preferences. */
export function canConfigureRadar(user) {
  const { planType } = resolveUserPlan(user);
  return planType === 'pro' || planType === 'elite';
}

/** Smart / AI-enhanced price alerts — Elite only. */
export function canUseSmartAlerts(user) {
  const { planType } = resolveUserPlan(user);
  return planType === 'elite';
}

/** Personal data export (CSV / JSON) — Elite only. */
export function canExportData(user) {
  const { planType } = resolveUserPlan(user);
  return planType === 'elite';
}

/**
 * Returns a machine-readable upgrade context key for use by the frontend
 * upgrade modal trigger.  Returns null when the user already has access.
 */
export function getUpgradeContext(user, feature) {
  const { planType } = resolveUserPlan(user);
  const needs = {
    radar:         planType === 'free' ? 'radar_access'        : null,
    ai_travel:     planType !== 'elite' ? 'ai_travel_limit'    : null,
    follows_limit: planType === 'free' ? 'follows_limit'       : planType === 'pro' ? 'follows_limit_pro' : null,
    rare_opps:     planType !== 'elite' ? 'rare_opportunities'  : null,
    smart_alerts:  planType !== 'elite' ? 'smart_alerts_limit'  : null,
    export:        planType !== 'elite'   ? 'export_limit'      : null,
    forecast:      (planType !== 'pro' && planType !== 'elite') ? 'forecast_access' : null
  };
  return needs[feature] ?? null;
}

export function setUserPlan(user, nextPlanType) {
  if (!user) return user;
  const planType = normalizePlanType(nextPlanType, Boolean(user?.isPremium));
  const planStatus = 'active';
  user.planType = planType;
  user.planStatus = planStatus;
  user.isPremium = planType !== 'free';
  user.premiumSince = planType !== 'free' ? new Date().toISOString() : null;
  return user;
}
