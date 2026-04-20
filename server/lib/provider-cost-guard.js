import { logger } from './logger.js';

const providerCostGuardMetrics = {
  checks: 0,
  allowed: 0,
  blocked: 0,
  backendUnavailable: 0,
  reasons: {},
  estimatedCallsBlocked: 0,
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

function toPositiveInt(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function readFlag(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['true', '1', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  return fallback;
}

function normalizeUserId(value) {
  const text = String(value || '').trim();
  return text || 'anonymous';
}

function normalizeRoute(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return 'UNKNOWN';
  return text.replace(/[^A-Z0-9._:-]+/g, '_').slice(0, 64) || 'UNKNOWN';
}

function bumpReason(reason) {
  const safeReason = String(reason || 'unknown').trim().toLowerCase() || 'unknown';
  providerCostGuardMetrics.reasons[safeReason] = Number(providerCostGuardMetrics.reasons[safeReason] || 0) + 1;
}

function markEvent() {
  providerCostGuardMetrics.lastEventAt = nowIso();
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
        globalDailyCalls: 2500,
        userDailyCalls: 80,
        globalPerMinuteCalls: 120,
        routeDailyCalls: 180,
        routePerMinuteCalls: 14
      }
    : {
        globalDailyCalls: 12000,
        userDailyCalls: 260,
        globalPerMinuteCalls: 300,
        routeDailyCalls: 450,
        routePerMinuteCalls: 30
      };

  return {
    // NOTE: missing/invalid/0 values now fall back to safe defaults.
    // This avoids uncontrolled provider spend in production.
    globalDailyCalls: toPositiveInt(env.SEARCH_PROVIDER_GLOBAL_DAILY_BUDGET, defaults.globalDailyCalls),
    userDailyCalls: toPositiveInt(env.SEARCH_PROVIDER_USER_DAILY_BUDGET, defaults.userDailyCalls),
    globalPerMinuteCalls: toPositiveInt(env.SEARCH_PROVIDER_GLOBAL_PER_MINUTE_BUDGET, defaults.globalPerMinuteCalls),
    routeDailyCalls: toPositiveInt(env.SEARCH_PROVIDER_ROUTE_DAILY_BUDGET, defaults.routeDailyCalls),
    routePerMinuteCalls: toPositiveInt(env.SEARCH_PROVIDER_ROUTE_PER_MINUTE_BUDGET, defaults.routePerMinuteCalls)
  };
}

/**
 * Claims provider call budget for a live inventory call.
 * Zero/empty limits disable that budget dimension.
 */
export async function claimProviderCallBudget({
  cacheClient,
  env = process.env,
  userId = '',
  route = '',
  plannedCalls = 1
} = {}) {
  providerCostGuardMetrics.checks += 1;
  markEvent();

  const safePlannedCalls = Math.max(1, toPositiveInt(plannedCalls, 1));
  const safeRoute = normalizeRoute(route);
  const safeUserId = normalizeUserId(userId);
  const failOpen = readFlag(env.SEARCH_PROVIDER_BUDGET_FAIL_OPEN, false);

  if (!cacheClient || typeof cacheClient.incr !== 'function') {
    providerCostGuardMetrics.backendUnavailable += 1;
    bumpReason(failOpen ? 'backend_unavailable_fail_open' : 'backend_unavailable_fail_closed');
    markEvent();
    if (failOpen) {
      providerCostGuardMetrics.allowed += 1;
      logger.warn({ route: safeRoute }, 'provider_cost_guard_backend_unavailable_fail_open');
      return { allowed: true, reason: 'backend_unavailable_fail_open' };
    }
    providerCostGuardMetrics.blocked += 1;
    providerCostGuardMetrics.estimatedCallsBlocked += safePlannedCalls;
    logger.warn({ route: safeRoute }, 'provider_cost_guard_backend_unavailable_fail_closed');
    return { allowed: false, reason: 'backend_unavailable_fail_closed' };
  }

  const limits = parseLimits(env);
  const now = Date.now();
  const dayBucket = dayKeyText(new Date(now));
  const minuteBucket = Math.floor(now / 60_000);

  const keys = {
    globalDailyCalls: `provider:budget:global:day:${dayBucket}:calls`,
    userDailyCalls: `provider:budget:user:${safeUserId}:day:${dayBucket}:calls`,
    globalPerMinuteCalls: `provider:budget:global:minute:${minuteBucket}:calls`,
    routeDailyCalls: `provider:budget:route:${safeRoute}:day:${dayBucket}:calls`,
    routePerMinuteCalls: `provider:budget:route:${safeRoute}:minute:${minuteBucket}:calls`
  };

  const checks = [];
  if (limits.globalDailyCalls > 0) checks.push({ key: keys.globalDailyCalls, amount: safePlannedCalls, limit: limits.globalDailyCalls, ttlSec: 24 * 60 * 60 + 180, reason: 'global_daily_calls_exceeded' });
  if (limits.userDailyCalls > 0) checks.push({ key: keys.userDailyCalls, amount: safePlannedCalls, limit: limits.userDailyCalls, ttlSec: 24 * 60 * 60 + 180, reason: 'user_daily_calls_exceeded' });
  if (limits.globalPerMinuteCalls > 0) checks.push({ key: keys.globalPerMinuteCalls, amount: safePlannedCalls, limit: limits.globalPerMinuteCalls, ttlSec: 180, reason: 'global_per_minute_calls_exceeded' });
  if (limits.routeDailyCalls > 0) checks.push({ key: keys.routeDailyCalls, amount: safePlannedCalls, limit: limits.routeDailyCalls, ttlSec: 24 * 60 * 60 + 180, reason: 'route_daily_calls_exceeded' });
  if (limits.routePerMinuteCalls > 0) checks.push({ key: keys.routePerMinuteCalls, amount: safePlannedCalls, limit: limits.routePerMinuteCalls, ttlSec: 180, reason: 'route_per_minute_calls_exceeded' });

  try {
    for (const item of checks) {
      const used = await incrBy(cacheClient, item.key, item.amount);
      if (typeof cacheClient.expire === 'function') {
        await cacheClient.expire(item.key, item.ttlSec).catch(() => {});
      }
      if (item.limit > 0 && used > item.limit) {
        providerCostGuardMetrics.blocked += 1;
        providerCostGuardMetrics.estimatedCallsBlocked += safePlannedCalls;
        bumpReason(item.reason);
        markEvent();
        logger.warn(
          {
            route: safeRoute,
            userId: safeUserId,
            reason: item.reason,
            used,
            limit: item.limit,
            plannedCalls: safePlannedCalls
          },
          'budget_exceeded_provider'
        );
        return {
          allowed: false,
          reason: item.reason,
          detail: { used, limit: item.limit, key: item.key }
        };
      }
    }
  } catch (error) {
    providerCostGuardMetrics.backendUnavailable += 1;
    bumpReason(failOpen ? 'budget_check_failed_fail_open' : 'budget_check_failed_fail_closed');
    markEvent();
    if (failOpen) {
      providerCostGuardMetrics.allowed += 1;
      logger.warn({ err: error?.message || String(error), route: safeRoute }, 'provider_cost_guard_failed_fail_open');
      return { allowed: true, reason: 'budget_check_failed_fail_open' };
    }
    providerCostGuardMetrics.blocked += 1;
    providerCostGuardMetrics.estimatedCallsBlocked += safePlannedCalls;
    logger.warn({ err: error?.message || String(error), route: safeRoute }, 'provider_cost_guard_failed_fail_closed');
    return { allowed: false, reason: 'budget_check_failed_fail_closed' };
  }

  providerCostGuardMetrics.allowed += 1;
  markEvent();
  return { allowed: true, reason: null };
}

export function getProviderCostGuardMetrics() {
  return {
    ...providerCostGuardMetrics
  };
}

export function resetProviderCostGuardMetrics() {
  providerCostGuardMetrics.checks = 0;
  providerCostGuardMetrics.allowed = 0;
  providerCostGuardMetrics.blocked = 0;
  providerCostGuardMetrics.backendUnavailable = 0;
  providerCostGuardMetrics.reasons = {};
  providerCostGuardMetrics.estimatedCallsBlocked = 0;
  providerCostGuardMetrics.lastEventAt = null;
}
