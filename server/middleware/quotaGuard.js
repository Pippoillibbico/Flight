import { checkAndIncrementQuota, verifyApiKey } from '../lib/saas-db.js';
import { readDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';

const SCOPE_SET = new Set(['read', 'search', 'alerts', 'export']);

function humanLimitMessage(counter) {
  if (counter === 'export') return 'Export limit reached for your current plan.';
  if (counter === 'search') return 'Search limit reached for your current plan.';
  if (counter === 'alerts') return 'Alert limit reached for your current plan.';
  if (counter === 'notifications') return 'Notification limit reached for your current plan.';
  return 'Usage limit reached for your current plan.';
}

export function requireApiScope(scope) {
  const needed = String(scope || '').toLowerCase();
  return function _requireApiScope(req, res, next) {
    if (!req.apiKeyId) return next();
    const scopes = Array.isArray(req.apiScopes) ? req.apiScopes.map((s) => String(s).toLowerCase()) : [];
    if (scopes.includes(needed)) return next();
    return res.status(403).json({
      error: 'insufficient_scope',
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
        metadata: { method: req.method, ip: req.ip }
      });

      if (!result.allowed) {
        logger.warn(
          {
            request_id: req.id || null,
            user_id: userId,
            endpoint: req.originalUrl || req.url,
            status_code: 429,
            quota_counter: result.counter,
            quota_limit: result.limit,
            quota_used: result.used
          },
          'quota_limit_exceeded'
        );
        return res.status(429).json({
          error: 'limit_exceeded',
          message: humanLimitMessage(result.counter),
          counter: result.counter,
          reset_at: result.resetAt,
          request_id: req.id || null
        });
      }

      res.set('X-Quota-Counter', String(result.counter));
      res.set('X-Quota-Limit', String(result.limit));
      res.set('X-Quota-Used', String(result.used));
      res.set('X-Quota-Remaining', String(result.remaining));
      res.set('X-Quota-Reset', String(result.resetAt));
      logger.info(
        {
          request_id: req.id || null,
          user_id: userId,
          endpoint: req.originalUrl || req.url,
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
