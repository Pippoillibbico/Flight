import { checkAndIncrementQuota, getOrCreateSubscription, verifyApiKey } from '../lib/saas-db.js';
import { readDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { anonymizeIpForLogs, hashValueForLogs, redactUrlForLogs } from '../lib/log-redaction.js';
import { getCacheClient } from '../lib/cache/index.js';
import { getPlanRuntimeLimits } from '../lib/plan-access.js';

const SCOPE_SET = new Set(['read', 'search', 'alerts', 'export']);
const cacheClient = getCacheClient();

function toPositiveInt(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function isGuardEnabled(env = process.env) {
  const isTest = String(env.NODE_ENV || '').trim().toLowerCase() === 'test';
  return !isTest && String(env.SEARCH_RUNTIME_GUARD_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

// Resolve per-plan rate limits from PLAN_RUNTIME_LIMITS.
// Env overrides are still honoured when set, so operators can tune without deploys.
function resolveSearchRateLimits(planId, env = process.env) {
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const plan = getPlanRuntimeLimits(planId);

  // Non-production keeps generous defaults so local dev is not throttled.
  if (!isProduction) {
    return {
      userPerMinute: toPositiveInt(env[`SEARCH_RUNTIME_${planId.toUpperCase()}_USER_PER_MINUTE`], 60),
      userPerDay: toPositiveInt(env[`SEARCH_RUNTIME_${planId.toUpperCase()}_USER_PER_DAY`], 600),
      sessionPerMinute: toPositiveInt(env[`SEARCH_RUNTIME_${planId.toUpperCase()}_SESSION_PER_MINUTE`], 40),
      sessionPerDay: toPositiveInt(env[`SEARCH_RUNTIME_${planId.toUpperCase()}_SESSION_PER_DAY`], 400)
    };
  }
  // Production: env overrides first, then PLAN_RUNTIME_LIMITS defaults.
  return {
    userPerMinute: toPositiveInt(env[`SEARCH_RUNTIME_${planId.toUpperCase()}_USER_PER_MINUTE`], plan.searchPerMin),
    userPerDay: toPositiveInt(env[`SEARCH_RUNTIME_${planId.toUpperCase()}_USER_PER_DAY`], plan.searchPerDay),
    sessionPerMinute: toPositiveInt(env[`SEARCH_RUNTIME_${planId.toUpperCase()}_SESSION_PER_MINUTE`], plan.sessionPerMin),
    sessionPerDay: toPositiveInt(env[`SEARCH_RUNTIME_${planId.toUpperCase()}_SESSION_PER_DAY`], plan.sessionPerDay)
  };
}

function resolveSessionKey(req) {
  const raw = String(
    req.headers?.['x-session-id'] ||
      req.cookies?.sid ||
      req.sessionID ||
      req.id ||
      ''
  )
    .trim()
    .slice(0, 128);
  return raw || 'anonymous_session';
}

function dayBucketText(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function bumpThrottleCounters({ counter = 'unknown', reason = 'rate_limited' } = {}) {
  if (!cacheClient || typeof cacheClient.incr !== 'function') return;
  const dayBucket = dayBucketText();
  const keys = [
    `quota:throttle:day:${dayBucket}:total`,
    `quota:throttle:day:${dayBucket}:${String(counter || 'unknown').toLowerCase()}`,
    `quota:throttle:day:${dayBucket}:reason:${String(reason || 'rate_limited').toLowerCase()}`
  ];
  for (const key of keys) {
    const value = Number(await cacheClient.incr(key));
    if (value === 1 && typeof cacheClient.expire === 'function') {
      await cacheClient.expire(key, 24 * 60 * 60 + 180).catch(() => {});
    }
  }
}

export async function getQuotaRuntimeMetrics() {
  if (!cacheClient || typeof cacheClient.get !== 'function') {
    return {
      dayBucket: dayBucketText(),
      throttledTotal: 0,
      throttledSearch: 0,
      throttledByReason: {}
    };
  }
  const dayBucket = dayBucketText();
  const [totalRaw, searchRaw, quotaRaw, runtimeRaw] = await Promise.all([
    cacheClient.get(`quota:throttle:day:${dayBucket}:total`).catch(() => '0'),
    cacheClient.get(`quota:throttle:day:${dayBucket}:search`).catch(() => '0'),
    cacheClient.get(`quota:throttle:day:${dayBucket}:reason:quota_limit_exceeded`).catch(() => '0'),
    cacheClient.get(`quota:throttle:day:${dayBucket}:reason:search_runtime_limit_exceeded`).catch(() => '0')
  ]);
  return {
    dayBucket,
    throttledTotal: Number(totalRaw || 0),
    throttledSearch: Number(searchRaw || 0),
    throttledByReason: {
      quota_limit_exceeded: Number(quotaRaw || 0),
      search_runtime_limit_exceeded: Number(runtimeRaw || 0)
    }
  };
}

async function claimSearchRuntimeBudget({ req, userId }) {
  if (!cacheClient || typeof cacheClient.incr !== 'function') return { allowed: true };
  if (!isGuardEnabled(process.env)) return { allowed: true };

  let planId = 'free';
  try {
    const subscription = await getOrCreateSubscription(String(userId || ''));
    planId = String(subscription?.planId || 'free').trim().toLowerCase();
  } catch {
    planId = 'free';
  }
  const effectiveLimits = resolveSearchRateLimits(planId, process.env);

  const nowMs = Date.now();
  const minuteBucket = Math.floor(nowMs / 60_000);
  const dayBucket = new Date(nowMs).toISOString().slice(0, 10);
  const sessionKey = resolveSessionKey(req);

  const checks = [
    {
      key: `search:runtime:user:${userId}:min:${minuteBucket}`,
      ttlSec: 180,
      limit: effectiveLimits.userPerMinute,
      reason: 'search_user_minute_limit_exceeded'
    },
    {
      key: `search:runtime:user:${userId}:day:${dayBucket}`,
      ttlSec: 24 * 60 * 60 + 180,
      limit: effectiveLimits.userPerDay,
      reason: 'search_user_daily_limit_exceeded'
    },
    {
      key: `search:runtime:session:${sessionKey}:min:${minuteBucket}`,
      ttlSec: 180,
      limit: effectiveLimits.sessionPerMinute,
      reason: 'search_session_minute_limit_exceeded'
    },
    {
      key: `search:runtime:session:${sessionKey}:day:${dayBucket}`,
      ttlSec: 24 * 60 * 60 + 180,
      limit: effectiveLimits.sessionPerDay,
      reason: 'search_session_daily_limit_exceeded'
    }
  ];

  for (const item of checks) {
    if (item.limit <= 0) continue;
    const used = Number(await cacheClient.incr(item.key));
    if (used === 1 && typeof cacheClient.expire === 'function') {
      await cacheClient.expire(item.key, item.ttlSec).catch(() => {});
    }
    if (used > item.limit) {
      return {
        allowed: false,
        reason: item.reason,
        detail: {
          used,
          limit: item.limit,
          key: item.key
        }
      };
    }
  }
  return { allowed: true };
}

function humanLimitMessage(counter) {
  if (counter === 'export') return 'Export limit reached for your current plan.';
  if (counter === 'search') return 'Search limit reached for your current plan.';
  if (counter === 'alerts') return 'Alert limit reached for your current plan.';
  if (counter === 'notifications') return 'Notification limit reached for your current plan.';
  return 'Usage limit reached for your current plan.';
}

export function requireApiScope(scope, options = {}) {
  const needed = String(scope || '').toLowerCase();
  const allowSession = options?.allowSession !== false;
  return function _requireApiScope(req, res, next) {
    if (!req.apiKeyId) {
      if (allowSession) return next();
      return res.status(403).json({
        error: 'forbidden',
        message: 'Session authentication is not allowed for this endpoint.',
        request_id: req.id || null
      });
    }
    const scopes = Array.isArray(req.apiScopes) ? req.apiScopes.map((s) => String(s).toLowerCase()) : [];
    if (scopes.includes(needed)) return next();
    return res.status(403).json({
      error: 'forbidden',
      message: `This API key is missing scope "${needed}".`,
      request_id: req.id || null
    });
  };
}

export function quotaGuard(cost = { counter: 'search', amount: 1 }) {
  return createQuotaGuard({ cost });
}

export function createQuotaGuard({
  cost = { counter: 'search', amount: 1 },
  checkQuota = checkAndIncrementQuota,
  warn = (message, detail) => logger.warn({ detail }, message)
} = {}) {
  return async function _quotaGuard(req, res, next) {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) return next();

    try {
      const result = await checkQuota(userId, cost, {
        endpoint: req.path,
        apiKeyId: req.apiKeyId || null,
        metadata: {
          method: req.method,
          ip_hash: anonymizeIpForLogs(req.ip),
          session_id_hash: hashValueForLogs(resolveSessionKey(req), { label: 'session', length: 16 })
        }
      });

      if (String(cost?.counter || '').trim().toLowerCase() === 'search') {
        const runtimeBudget = await claimSearchRuntimeBudget({ req, userId: String(userId) });
        if (!runtimeBudget.allowed) {
          const endpoint = redactUrlForLogs(req.originalUrl || req.url, { maxLength: 220 });
          logger.warn(
            {
              request_id: req.id || null,
              user_id: userId,
              endpoint,
              status_code: 429,
              reason: runtimeBudget.reason,
              detail: runtimeBudget.detail || null
            },
            'search_runtime_throttled'
          );
          await bumpThrottleCounters({ counter: 'search', reason: 'search_runtime_limit_exceeded' });
          return res.status(429).json({
            error: 'rate_limited',
            message: 'Search rate limit reached. Please wait before trying again.',
            reason: runtimeBudget.reason,
            upgrade_context: 'search_limit',
            request_id: req.id || null
          });
        }
      }

      if (!result.allowed) {
        const endpoint = redactUrlForLogs(req.originalUrl || req.url, { maxLength: 220 });
        logger.warn(
          {
            request_id: req.id || null,
            user_id: userId,
            endpoint,
            status_code: 429,
            quota_counter: result.counter,
            quota_limit: result.limit,
            quota_used: result.used
          },
          'quota_limit_exceeded'
        );
        await bumpThrottleCounters({ counter: result.counter, reason: 'quota_limit_exceeded' });
        return res.status(429).json({
          error: 'rate_limited',
          message: humanLimitMessage(result.counter),
          counter: result.counter,
          reset_at: result.resetAt,
          upgrade_context: result.counter === 'search' ? 'search_limit' : undefined,
          request_id: req.id || null
        });
      }

      res.set('X-Quota-Counter', String(result.counter));
      res.set('X-Quota-Limit', String(result.limit));
      res.set('X-Quota-Used', String(result.used));
      res.set('X-Quota-Remaining', String(result.remaining));
      res.set('X-Quota-Reset', String(result.resetAt));
      const endpoint = redactUrlForLogs(req.originalUrl || req.url, { maxLength: 220 });
      logger.info(
        {
          request_id: req.id || null,
          user_id: userId,
          endpoint,
          status_code: 200,
          quota_counter: result.counter,
          quota_limit: result.limit,
          quota_used: result.used,
          quota_remaining: result.remaining
        },
        'quota_usage_recorded'
      );
      return next();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        warn('[quotaGuard] non-fatal error:', error?.message);
        return next();
      }
      return next(error);
    }
  };
}

export async function apiKeyAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer fsk_')) return next();

  const rawKey = authHeader.slice(7).trim();
  try {
    const keyInfo = await verifyApiKey(rawKey);
    if (!keyInfo) {
      return res.status(401).json({ error: 'auth_invalid', message: 'Invalid or revoked API key.', request_id: req.id || null });
    }

    const db = await readDb();
    const user = (db.users || []).find((u) => u.id === keyInfo.userId);
    if (!user) {
      return res.status(401).json({ error: 'auth_invalid', message: 'API key owner not found.', request_id: req.id || null });
    }

    req.user = { ...user, sub: user.id };
    req.authSource = 'api_key';
    req.apiKeyId = keyInfo.keyId;
    req.apiScopes = (keyInfo.scopes || []).filter((s) => SCOPE_SET.has(String(s).toLowerCase()));
    return next();
  } catch (error) {
    return next(error);
  }
}
