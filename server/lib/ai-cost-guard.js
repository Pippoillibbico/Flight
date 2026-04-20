import { logger } from './logger.js';
import { getPlanRuntimeLimits, normalizePlanType } from './plan-access.js';

const aiCostGuardMetrics = {
  checks: 0,
  allowed: 0,
  blocked: 0,
  backendUnavailable: 0,
  reasons: {},
  estimatedTokensBlocked: 0,
  estimatedCostBlockedEur: 0,
  lastEventAt: null
};

function nowIso() {
  return new Date().toISOString();
}

function dayKeyText(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function monthKeyText(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

function toFinite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function normalizeUserId(value) {
  const text = String(value || '').trim();
  return text || 'anonymous';
}

function normalizeRoute(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 'unknown';
  return text.replace(/[^a-z0-9._:-]+/g, '_').slice(0, 64) || 'unknown';
}

function bumpReason(reason) {
  const key = String(reason || 'unknown').trim().toLowerCase() || 'unknown';
  aiCostGuardMetrics.reasons[key] = Number(aiCostGuardMetrics.reasons[key] || 0) + 1;
}

function markEvent() {
  aiCostGuardMetrics.lastEventAt = nowIso();
}

async function incrBy(cacheClient, key, amount) {
  const safeAmount = Math.max(0, toPositiveInt(amount, 0));
  if (!safeAmount) return 0;
  if (typeof cacheClient?.incrby === 'function') {
    return Number(await cacheClient.incrby(key, safeAmount));
  }
  if (typeof cacheClient?.incr === 'function') {
    let out = 0;
    for (let i = 0; i < safeAmount; i += 1) {
      out = Number(await cacheClient.incr(key));
    }
    return out;
  }
  return 0;
}

function parseLimits(env) {
  const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
  const defaults = isProduction
    ? {
        globalDailyCalls: 320,
        globalPerMinuteCalls: 16,
        userDailyCalls: 12,
        routeDailyCalls: 40,
        globalDailyEstimatedTokens: 220000,
        userDailyEstimatedTokens: 12000,
        routeDailyEstimatedTokens: 36000,
        globalMonthlyEstimatedTokens: 3000000,
        userMonthlyEstimatedTokens: 150000,
        routeMonthlyEstimatedTokens: 380000
      }
    : {
        globalDailyCalls: 2400,
        globalPerMinuteCalls: 80,
        userDailyCalls: 160,
        routeDailyCalls: 360,
        globalDailyEstimatedTokens: 1200000,
        userDailyEstimatedTokens: 90000,
        routeDailyEstimatedTokens: 180000,
        globalMonthlyEstimatedTokens: 12000000,
        userMonthlyEstimatedTokens: 1200000,
        routeMonthlyEstimatedTokens: 2200000
      };

  return {
    // NOTE: 0/missing/invalid values now use safe defaults to avoid unlimited AI spend.
    globalDailyCalls: toPositiveInt(env.AI_BUDGET_GLOBAL_DAILY_CALLS, defaults.globalDailyCalls),
    globalPerMinuteCalls: toPositiveInt(env.AI_BUDGET_GLOBAL_PER_MINUTE_CALLS, defaults.globalPerMinuteCalls),
    userDailyCalls: toPositiveInt(env.AI_BUDGET_USER_DAILY_CALLS, defaults.userDailyCalls),
    routeDailyCalls: toPositiveInt(env.AI_BUDGET_ROUTE_DAILY_CALLS, defaults.routeDailyCalls),
    globalDailyEstimatedTokens: toPositiveInt(env.AI_BUDGET_GLOBAL_DAILY_EST_TOKENS, defaults.globalDailyEstimatedTokens),
    userDailyEstimatedTokens: toPositiveInt(env.AI_BUDGET_USER_DAILY_EST_TOKENS, defaults.userDailyEstimatedTokens),
    routeDailyEstimatedTokens: toPositiveInt(env.AI_BUDGET_ROUTE_DAILY_EST_TOKENS, defaults.routeDailyEstimatedTokens),
    globalMonthlyEstimatedTokens: toPositiveInt(
      env.AI_BUDGET_GLOBAL_MONTHLY_EST_TOKENS,
      defaults.globalMonthlyEstimatedTokens
    ),
    userMonthlyEstimatedTokens: toPositiveInt(
      env.AI_BUDGET_USER_MONTHLY_EST_TOKENS,
      defaults.userMonthlyEstimatedTokens
    ),
    routeMonthlyEstimatedTokens: toPositiveInt(
      env.AI_BUDGET_ROUTE_MONTHLY_EST_TOKENS,
      defaults.routeMonthlyEstimatedTokens
    )
  };
}

// Resolve per-plan AI limits, merging PLAN_RUNTIME_LIMITS with env overrides.
// Returns { userDailyCalls, userMonthlyTokens } — 0 means "no plan-level limit".
function resolvePlanAiLimits(planType, env) {
  const normalizedPlan = normalizePlanType(planType, false);
  const plan = getPlanRuntimeLimits(normalizedPlan);
  if (!plan.aiEnabled) {
    // AI disabled for this plan: block by setting 0 calls/day.
    return { userDailyCalls: 0, userMonthlyTokens: 0 };
  }
  const callsPerDay = toPositiveInt(env.AI_BUDGET_PLAN_DAILY_CALLS, plan.aiCallsPerDay);
  const tokensPerMonth = toPositiveInt(env.AI_BUDGET_PLAN_MONTHLY_TOKENS, plan.aiTokensPerMonth);
  return { userDailyCalls: callsPerDay, userMonthlyTokens: tokensPerMonth };
}

/**
 * Claim AI budget before executing a live AI call.
 * Zero/empty limits disable that budget dimension.
 * Pass planType to enforce per-plan daily-call and monthly-token caps on top of
 * the global budget limits.
 */
export async function claimAiBudget({
  cacheClient,
  env = process.env,
  userId = '',
  route = 'unknown',
  estimatedTokens = 0,
  estimatedCostEur = 0,
  planType = ''
} = {}) {
  aiCostGuardMetrics.checks += 1;
  markEvent();
  const failOpen = String(env?.AI_BUDGET_FAIL_OPEN || '').trim().toLowerCase() === 'true';

  if (!cacheClient || typeof cacheClient.incr !== 'function') {
    aiCostGuardMetrics.backendUnavailable += 1;
    const safeRoute = normalizeRoute(route);
    if (failOpen) {
      aiCostGuardMetrics.allowed += 1;
      bumpReason('backend_unavailable_fail_open');
      logger.warn({ route: safeRoute }, 'ai_cost_guard_backend_unavailable_fail_open');
      return { allowed: true, reason: 'backend_unavailable_fail_open' };
    }
    aiCostGuardMetrics.blocked += 1;
    bumpReason('backend_unavailable_fail_closed');
    logger.warn({ route: safeRoute }, 'ai_cost_guard_backend_unavailable_fail_closed');
    return { allowed: false, reason: 'backend_unavailable_fail_closed' };
  }

  const limits = parseLimits(env);
  // Per-plan AI limits: override user-level caps with plan-specific values.
  const planAiLimits = resolvePlanAiLimits(planType, env);
  const safeRoute = normalizeRoute(route);
  const safeUserId = normalizeUserId(userId);
  const safeEstimatedTokens = Math.max(0, toPositiveInt(estimatedTokens, 0));

  const now = Date.now();
  const dayBucket = dayKeyText(new Date(now));
  const monthBucket = monthKeyText(new Date(now));
  const minuteBucket = Math.floor(now / 60_000);

  // Plan-specific Redis keys are namespaced separately so they don't interfere
  // with global budget counters for the same user.
  const normalizedPlan = normalizePlanType(planType, false);
  const keys = {
    globalDailyCalls: `ai:budget:global:day:${dayBucket}:calls`,
    globalPerMinuteCalls: `ai:budget:global:minute:${minuteBucket}:calls`,
    userDailyCalls: `ai:budget:user:${safeUserId}:day:${dayBucket}:calls`,
    routeDailyCalls: `ai:budget:route:${safeRoute}:day:${dayBucket}:calls`,
    planUserDailyCalls: `ai:budget:plan:${normalizedPlan}:user:${safeUserId}:day:${dayBucket}:calls`,
    planUserMonthlyTokens: `ai:budget:plan:${normalizedPlan}:user:${safeUserId}:month:${monthBucket}:est_tokens`,
    globalMonthlyTokens: `ai:budget:global:month:${monthBucket}:est_tokens`,
    userMonthlyTokens: `ai:budget:user:${safeUserId}:month:${monthBucket}:est_tokens`,
    routeMonthlyTokens: `ai:budget:route:${safeRoute}:month:${monthBucket}:est_tokens`,
    globalDailyTokens: `ai:budget:global:day:${dayBucket}:est_tokens`,
    userDailyTokens: `ai:budget:user:${safeUserId}:day:${dayBucket}:est_tokens`,
    routeDailyTokens: `ai:budget:route:${safeRoute}:day:${dayBucket}:est_tokens`
  };

  const checks = [];
  if (limits.globalDailyCalls > 0) checks.push({ key: keys.globalDailyCalls, amount: 1, limit: limits.globalDailyCalls, ttlSec: 24 * 60 * 60 + 180, reason: 'global_daily_calls_exceeded' });
  if (limits.globalPerMinuteCalls > 0) checks.push({ key: keys.globalPerMinuteCalls, amount: 1, limit: limits.globalPerMinuteCalls, ttlSec: 180, reason: 'global_per_minute_calls_exceeded' });
  if (limits.userDailyCalls > 0) checks.push({ key: keys.userDailyCalls, amount: 1, limit: limits.userDailyCalls, ttlSec: 24 * 60 * 60 + 180, reason: 'user_daily_calls_exceeded' });
  if (limits.routeDailyCalls > 0) checks.push({ key: keys.routeDailyCalls, amount: 1, limit: limits.routeDailyCalls, ttlSec: 24 * 60 * 60 + 180, reason: 'route_daily_calls_exceeded' });
  // Per-plan caps (stricter than global): block if plan daily-call limit is reached.
  if (planAiLimits.userDailyCalls > 0) checks.push({ key: keys.planUserDailyCalls, amount: 1, limit: planAiLimits.userDailyCalls, ttlSec: 24 * 60 * 60 + 180, reason: 'plan_user_daily_calls_exceeded' });
  if (planAiLimits.userMonthlyTokens > 0 && safeEstimatedTokens > 0) checks.push({ key: keys.planUserMonthlyTokens, amount: safeEstimatedTokens, limit: planAiLimits.userMonthlyTokens, ttlSec: 33 * 24 * 60 * 60, reason: 'plan_user_monthly_tokens_exceeded' });
  if (limits.globalDailyEstimatedTokens > 0 && safeEstimatedTokens > 0) checks.push({ key: keys.globalDailyTokens, amount: safeEstimatedTokens, limit: limits.globalDailyEstimatedTokens, ttlSec: 24 * 60 * 60 + 180, reason: 'global_daily_est_tokens_exceeded' });
  if (limits.userDailyEstimatedTokens > 0 && safeEstimatedTokens > 0) checks.push({ key: keys.userDailyTokens, amount: safeEstimatedTokens, limit: limits.userDailyEstimatedTokens, ttlSec: 24 * 60 * 60 + 180, reason: 'user_daily_est_tokens_exceeded' });
  if (limits.routeDailyEstimatedTokens > 0 && safeEstimatedTokens > 0) checks.push({ key: keys.routeDailyTokens, amount: safeEstimatedTokens, limit: limits.routeDailyEstimatedTokens, ttlSec: 24 * 60 * 60 + 180, reason: 'route_daily_est_tokens_exceeded' });
  if (limits.globalMonthlyEstimatedTokens > 0 && safeEstimatedTokens > 0) checks.push({ key: keys.globalMonthlyTokens, amount: safeEstimatedTokens, limit: limits.globalMonthlyEstimatedTokens, ttlSec: 33 * 24 * 60 * 60, reason: 'global_monthly_est_tokens_exceeded' });
  if (limits.userMonthlyEstimatedTokens > 0 && safeEstimatedTokens > 0) checks.push({ key: keys.userMonthlyTokens, amount: safeEstimatedTokens, limit: limits.userMonthlyEstimatedTokens, ttlSec: 33 * 24 * 60 * 60, reason: 'user_monthly_est_tokens_exceeded' });
  if (limits.routeMonthlyEstimatedTokens > 0 && safeEstimatedTokens > 0) checks.push({ key: keys.routeMonthlyTokens, amount: safeEstimatedTokens, limit: limits.routeMonthlyEstimatedTokens, ttlSec: 33 * 24 * 60 * 60, reason: 'route_monthly_est_tokens_exceeded' });

  try {
    for (const item of checks) {
      const used = await incrBy(cacheClient, item.key, item.amount);
      if (typeof cacheClient.expire === 'function') {
        await cacheClient.expire(item.key, item.ttlSec).catch(() => {});
      }
      if (item.limit > 0 && used > item.limit) {
        aiCostGuardMetrics.blocked += 1;
        aiCostGuardMetrics.estimatedTokensBlocked += safeEstimatedTokens;
        aiCostGuardMetrics.estimatedCostBlockedEur += Math.max(0, toFinite(estimatedCostEur, 0));
        bumpReason(item.reason);
        markEvent();
        logger.warn(
          {
            route: safeRoute,
            userId: safeUserId,
            reason: item.reason,
            used,
            limit: item.limit,
            estimatedTokens: safeEstimatedTokens,
            estimatedCostEur: toFinite(estimatedCostEur, 0)
          },
          'budget_exceeded_ai'
        );
        return {
          allowed: false,
          reason: item.reason,
          detail: { used, limit: item.limit, key: item.key }
        };
      }
    }
  } catch (error) {
    aiCostGuardMetrics.backendUnavailable += 1;
    if (failOpen) {
      aiCostGuardMetrics.allowed += 1;
      bumpReason('budget_check_failed_fail_open');
      markEvent();
      logger.warn({ err: error?.message || String(error), route: safeRoute }, 'ai_cost_guard_failed_fail_open');
      return { allowed: true, reason: 'budget_check_failed_fail_open' };
    }
    aiCostGuardMetrics.blocked += 1;
    bumpReason('budget_check_failed_fail_closed');
    markEvent();
    logger.warn({ err: error?.message || String(error), route: safeRoute }, 'ai_cost_guard_failed_fail_closed');
    return { allowed: false, reason: 'budget_check_failed_fail_closed' };
  }

  aiCostGuardMetrics.allowed += 1;
  markEvent();
  return { allowed: true, reason: null };
}

export function getAiCostGuardMetrics() {
  return {
    ...aiCostGuardMetrics,
    estimatedCostBlockedEur: Math.round(aiCostGuardMetrics.estimatedCostBlockedEur * 1_000_000) / 1_000_000
  };
}

export function resetAiCostGuardMetrics() {
  aiCostGuardMetrics.checks = 0;
  aiCostGuardMetrics.allowed = 0;
  aiCostGuardMetrics.blocked = 0;
  aiCostGuardMetrics.backendUnavailable = 0;
  aiCostGuardMetrics.reasons = {};
  aiCostGuardMetrics.estimatedTokensBlocked = 0;
  aiCostGuardMetrics.estimatedCostBlockedEur = 0;
  aiCostGuardMetrics.lastEventAt = null;
}
