import { randomUUID } from 'node:crypto';

const CONSENT_CATEGORIES = ['necessary', 'analytics', 'marketing', 'personalization'];
const DEFAULT_CONSENT_CATEGORIES = Object.freeze({
  necessary: true,
  analytics: false,
  marketing: false,
  personalization: false
});
const DEFAULT_POLICY_VERSION = String(process.env.CONSENT_POLICY_VERSION || '2026-04-27').trim() || '2026-04-27';
const DEFAULT_ANON_COOKIE_NAME = String(process.env.CONSENT_ANON_COOKIE_NAME || 'anonId').trim() || 'anonId';
const DEFAULT_ANON_COOKIE_TTL_MS = Math.max(24 * 60 * 60 * 1000, Number(process.env.CONSENT_ANON_COOKIE_TTL_MS || 180 * 24 * 60 * 60 * 1000));

function normalizeCategories(rawValue) {
  const source = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) ? rawValue : {};
  return {
    necessary: true,
    analytics: Boolean(source.analytics),
    marketing: Boolean(source.marketing),
    personalization: Boolean(source.personalization)
  };
}

function normalizeIdentity({ userId = null, anonymousId = null } = {}) {
  const normalizedUserId = String(userId || '').trim() || null;
  const normalizedAnonymousId = String(anonymousId || '').trim() || null;
  return {
    userId: normalizedUserId,
    anonymousId: normalizedAnonymousId
  };
}

function buildConsentRecord(input = {}) {
  return {
    userId: String(input.userId || '').trim() || null,
    anonymousId: String(input.anonymousId || '').trim() || null,
    categories: normalizeCategories(input.categories),
    version: String(input.version || DEFAULT_POLICY_VERSION).trim() || DEFAULT_POLICY_VERSION,
    timestamp: new Date(input.timestamp || Date.now()).toISOString(),
    ipHash: input.ipHash || null,
    userAgentHash: input.userAgentHash || null
  };
}

export function canTrack(req, category) {
  const normalizedCategory = String(category || '').trim().toLowerCase();
  if (normalizedCategory === 'necessary') return true;
  if (!CONSENT_CATEGORIES.includes(normalizedCategory)) return false;
  const consent = req?.userConsent;
  if (!consent || typeof consent !== 'object') return false;
  const categories = consent.categories && typeof consent.categories === 'object' ? consent.categories : {};
  return categories[normalizedCategory] === true;
}

export function createConsentService({
  pgPool = null,
  withDb,
  readDb,
  getCookies,
  optionalAuth = null,
  hashValueForLogs,
  anonymizeIpForLogs,
  policyVersion = DEFAULT_POLICY_VERSION,
  anonymousCookieName = DEFAULT_ANON_COOKIE_NAME,
  anonymousCookieTtlMs = DEFAULT_ANON_COOKIE_TTL_MS
}) {
  function tryResolveOptionalUser(req) {
    if (req?.user?.id || req?.user?.sub) return req.user;
    if (typeof optionalAuth !== 'function') return null;
    const payload = optionalAuth(req);
    if (payload && typeof payload === 'object') req.user = payload;
    return req?.user || null;
  }

  function getRequestAnonymousId(req) {
    const cookies = typeof getCookies === 'function' ? getCookies(req) : {};
    return String(cookies?.[anonymousCookieName] || '').trim() || null;
  }

  function ensureAnonymousIdCookie(req, res) {
    const existing = getRequestAnonymousId(req);
    if (existing) return existing;
    const anonymousId = randomUUID();
    const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    if (typeof res?.cookie === 'function') {
      res.cookie(anonymousCookieName, anonymousId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        path: '/',
        maxAge: anonymousCookieTtlMs
      });
    } else {
      const cookieParts = [
        `${anonymousCookieName}=${anonymousId}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${Math.floor(anonymousCookieTtlMs / 1000)}`
      ];
      if (isProduction) cookieParts.push('Secure');
      res.setHeader('Set-Cookie', cookieParts.join('; '));
    }
    return anonymousId;
  }

  async function readConsentFromStore(identity) {
    if (identity.userId && pgPool) {
      const result = await pgPool.query(
        `SELECT user_id, categories, version, consented_at, ip_hash, user_agent_hash
         FROM user_consents
         WHERE user_id = $1
         LIMIT 1`,
        [identity.userId]
      );
      const row = result.rows[0] || null;
      if (row) {
        return buildConsentRecord({
          userId: row.user_id,
          categories: row.categories || {},
          version: row.version,
          timestamp: row.consented_at,
          ipHash: row.ip_hash || null,
          userAgentHash: row.user_agent_hash || null
        });
      }
    }
    if (identity.anonymousId && pgPool) {
      const result = await pgPool.query(
        `SELECT anonymous_id, categories, version, consented_at, ip_hash, user_agent_hash
         FROM consent_sessions
         WHERE anonymous_id = $1
         LIMIT 1`,
        [identity.anonymousId]
      );
      const row = result.rows[0] || null;
      if (row) {
        return buildConsentRecord({
          anonymousId: row.anonymous_id,
          categories: row.categories || {},
          version: row.version,
          timestamp: row.consented_at,
          ipHash: row.ip_hash || null,
          userAgentHash: row.user_agent_hash || null
        });
      }
    }

    const db = await readDb();
    if (identity.userId) {
      const row = (Array.isArray(db.userConsents) ? db.userConsents : []).find((item) => String(item?.userId || '') === identity.userId) || null;
      if (row) return buildConsentRecord(row);
    }
    if (identity.anonymousId) {
      const row =
        (Array.isArray(db.consentSessions) ? db.consentSessions : []).find((item) => String(item?.anonymousId || '') === identity.anonymousId) || null;
      if (row) return buildConsentRecord(row);
    }
    return null;
  }

  async function writeConsentToStore(record) {
    if (record.userId && pgPool) {
      await pgPool.query(
        `INSERT INTO user_consents (user_id, categories, version, consented_at, ip_hash, user_agent_hash, updated_at)
         VALUES ($1, $2::jsonb, $3, $4::timestamptz, $5, $6, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET categories = EXCLUDED.categories,
                       version = EXCLUDED.version,
                       consented_at = EXCLUDED.consented_at,
                       ip_hash = EXCLUDED.ip_hash,
                       user_agent_hash = EXCLUDED.user_agent_hash,
                       updated_at = NOW()`,
        [record.userId, JSON.stringify(record.categories), record.version, record.timestamp, record.ipHash, record.userAgentHash]
      );
      return record;
    }
    if (record.anonymousId && pgPool) {
      await pgPool.query(
        `INSERT INTO consent_sessions (anonymous_id, categories, version, consented_at, ip_hash, user_agent_hash, updated_at)
         VALUES ($1, $2::jsonb, $3, $4::timestamptz, $5, $6, NOW())
         ON CONFLICT (anonymous_id)
         DO UPDATE SET categories = EXCLUDED.categories,
                       version = EXCLUDED.version,
                       consented_at = EXCLUDED.consented_at,
                       ip_hash = EXCLUDED.ip_hash,
                       user_agent_hash = EXCLUDED.user_agent_hash,
                       updated_at = NOW()`,
        [record.anonymousId, JSON.stringify(record.categories), record.version, record.timestamp, record.ipHash, record.userAgentHash]
      );
      return record;
    }

    await withDb(async (db) => {
      db.userConsents = Array.isArray(db.userConsents) ? db.userConsents : [];
      db.consentSessions = Array.isArray(db.consentSessions) ? db.consentSessions : [];
      if (record.userId) {
        const next = db.userConsents.filter((item) => String(item?.userId || '') !== record.userId);
        next.push(record);
        db.userConsents = next.slice(-10000);
        return db;
      }
      if (record.anonymousId) {
        const next = db.consentSessions.filter((item) => String(item?.anonymousId || '') !== record.anonymousId);
        next.push(record);
        db.consentSessions = next.slice(-20000);
      }
      return db;
    });
    return record;
  }

  function resolveIdentityFromRequest(req, res, { ensureAnonymousId = false } = {}) {
    const authPayload = tryResolveOptionalUser(req);
    const userId = String(authPayload?.id || authPayload?.sub || '').trim() || null;
    let anonymousId = getRequestAnonymousId(req);
    if (!anonymousId && ensureAnonymousId) anonymousId = ensureAnonymousIdCookie(req, res);
    return normalizeIdentity({ userId, anonymousId });
  }

  async function getConsentForRequest(req, res, { ensureAnonymousId = false } = {}) {
    const identity = resolveIdentityFromRequest(req, res, { ensureAnonymousId });
    const consent = await readConsentFromStore(identity);
    return {
      identity,
      consent: consent ? buildConsentRecord(consent) : null
    };
  }

  async function saveConsentForRequest(req, res, categoriesInput) {
    const { identity } = await getConsentForRequest(req, res, { ensureAnonymousId: true });
    if (!identity.userId && !identity.anonymousId) return null;
    const userAgentRaw = String(req?.headers?.['user-agent'] || '').trim();
    const record = buildConsentRecord({
      userId: identity.userId,
      anonymousId: identity.userId ? null : identity.anonymousId,
      categories: categoriesInput,
      version: policyVersion,
      timestamp: new Date().toISOString(),
      ipHash: anonymizeIpForLogs(req.ip || req.socket?.remoteAddress || ''),
      userAgentHash: userAgentRaw ? hashValueForLogs(userAgentRaw, { label: 'ua', length: 24 }) : null
    });
    await writeConsentToStore(record);
    return record;
  }

  function attachUserConsent() {
    return async (req, res, next) => {
      try {
        const { identity, consent } = await getConsentForRequest(req, res, { ensureAnonymousId: false });
        req.userConsentIdentity = identity;
        req.userConsent = consent;
        return next();
      } catch (error) {
        return next(error);
      }
    };
  }

  return {
    anonymousCookieName,
    policyVersion,
    normalizeCategories,
    getConsentForRequest,
    saveConsentForRequest,
    attachUserConsent
  };
}
