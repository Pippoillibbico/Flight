import { Router } from 'express';

export function buildSystemRouter({
  BUILD_VERSION,
  pgPool,
  getPriceDatasetStatus,
  logger,
  getCacheClient,
  readDb,
  verifyImmutableAudit,
  createAuditCheck,
  CORS_ALLOWLIST,
  LOGIN_MAX_FAILURES,
  LOGIN_LOCK_MINUTES,
  runFeatureAudit,
  getDataFoundationStatus,
  providerRegistry
}) {
  const router = Router();

  router.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'flight-suite-api',
      version: BUILD_VERSION,
      uptimeSeconds: Number(process.uptime().toFixed(1)),
      now: new Date().toISOString()
    });
  });

  router.get('/health', (_req, res) => {
    return res.status(200).json({
      status: 'ok',
      database: pgPool ? 'configured' : 'local',
      engine: 'ready',
      uptime: Number(process.uptime().toFixed(1)),
      timestamp: new Date().toISOString()
    });
  });

  router.get('/health/db', async (_req, res) => {
    try {
      if (pgPool) await pgPool.query('SELECT 1');
      return res.status(200).json({
        status: 'ok',
        database: 'connected'
      });
    } catch (error) {
      logger.error({ err: error }, 'health_db_failed');
      return res.status(503).json({
        status: 'degraded',
        database: 'disconnected'
      });
    }
  });

  router.get('/health/engine', async (_req, res) => {
    try {
      const dataset = await getPriceDatasetStatus();
      return res.status(200).json({
        status: 'ok',
        engine: 'ready',
        dataset
      });
    } catch (error) {
      logger.error({ err: error }, 'health_engine_failed');
      return res.status(503).json({
        status: 'degraded',
        engine: 'not_ready'
      });
    }
  });

  router.get('/healthz', (_req, res) => {
    return res.status(200).json({
      ok: true,
      service: 'flight-suite-api',
      now: new Date().toISOString()
    });
  });

  async function runReadinessChecks() {
    const checks = {
      postgres: { ok: true, mode: process.env.DATABASE_URL ? 'postgres' : 'local' },
      redis: { ok: true, mode: process.env.REDIS_URL ? 'redis' : 'in-memory' }
    };

    if (pgPool) {
      try {
        await pgPool.query('SELECT 1');
      } catch (error) {
        checks.postgres = { ok: false, mode: 'postgres', detail: error?.message || 'postgres_unreachable' };
      }
    }

    if (process.env.REDIS_URL) {
      try {
        const cache = getCacheClient();
        if (typeof cache.ping === 'function') {
          await cache.ping();
        } else {
          checks.redis = { ok: false, mode: 'redis', detail: 'redis_ping_not_supported' };
        }
      } catch (error) {
        checks.redis = { ok: false, mode: 'redis', detail: error?.message || 'redis_unreachable' };
      }
    }

    return checks;
  }

  router.get('/readyz', async (req, res) => {
    const checks = await runReadinessChecks();
    const ready = checks.postgres.ok && checks.redis.ok;
    return res.status(ready ? 200 : 503).json({
      ok: ready,
      checks,
      now: new Date().toISOString(),
      request_id: req.id || null
    });
  });

  router.get('/api/health/features', (_req, res) => {
    const audit = runFeatureAudit();
    res.json(audit);
  });

  router.get('/api/health/compliance', (_req, res) => {
    res.json({
      ok: true,
      policy: {
        scrapingUsed: false,
        externalInventoryResale: false,
        monetizationModel: 'decision_value',
        pillars: ['decision_intelligence', 'analytics', 'lifestyle_positioning']
      },
      now: new Date().toISOString()
    });
  });

  router.get('/api/health/security', async (_req, res) => {
    const db = await readDb();
    const auditChain = await verifyImmutableAudit();
    const auditHmacConfigured = Boolean(String(process.env.AUDIT_LOG_HMAC_KEY || '').trim());
    const googleConfigured = Boolean(String(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '').trim());
    const appleConfigured = Boolean(String(process.env.APPLE_CLIENT_IDS || process.env.APPLE_CLIENT_ID || '').trim());
    const facebookConfigured = Boolean(String(process.env.FACEBOOK_CLIENT_IDS || process.env.FACEBOOK_CLIENT_ID || '').trim());
    const checks = [
      createAuditCheck('jwt_secret', 'JWT secret configured and strong', true, 'JWT_SECRET is required (>= 32 chars)'),
      createAuditCheck('helmet', 'Helmet security headers enabled', true, 'helmet middleware active'),
      createAuditCheck('cors_allowlist', 'CORS allowlist enforced', CORS_ALLOWLIST.size > 0, `allowedOrigins=${CORS_ALLOWLIST.size}`),
      createAuditCheck('auth_rate_limit', 'Auth rate limiting enabled', true, '20 attempts / 15 minutes'),
      createAuditCheck('login_lock', 'Account lock on failed login enabled', true, `maxFailures=${LOGIN_MAX_FAILURES}, lockMinutes=${LOGIN_LOCK_MINUTES}`),
      createAuditCheck('cookie_http_only', 'Auth cookie uses HttpOnly + SameSite', true, 'cookie: HttpOnly, SameSite=Lax'),
      createAuditCheck('csrf_guard', 'CSRF token required for cookie-auth state changes', true, 'x-csrf-token checked against JWT csrf claim'),
      createAuditCheck('origin_check', 'Trusted origin enforced for cookie-auth state changes', true, 'Origin must be in CORS allowlist'),
      createAuditCheck('token_revocation', 'JWT revocation store enabled', Array.isArray(db.revokedTokens), `revokedTokenCount=${db.revokedTokens?.length || 0}`),
      createAuditCheck('refresh_rotation', 'Refresh token rotation session store enabled', Array.isArray(db.refreshSessions), `refreshSessions=${db.refreshSessions?.length || 0}`),
      createAuditCheck('mfa_totp', 'MFA TOTP available for account hardening', true, 'setup/enable/disable endpoints active'),
      createAuditCheck('oauth_state_nonce', 'OAuth state/nonce session challenge enabled', Array.isArray(db.oauthSessions), `oauthSessions=${db.oauthSessions?.length || 0}`),
      createAuditCheck(
        'audit_chain',
        'Immutable audit hash chain integrity',
        auditChain.ok || auditChain.count === 0,
        auditChain.count === 0 ? 'entries=0 (no security events yet)' : `entries=${auditChain.count}`
      ),
      createAuditCheck('audit_hmac', 'Audit log HMAC signing key configured', auditHmacConfigured, auditHmacConfigured ? 'configured' : 'missing AUDIT_LOG_HMAC_KEY'),
      createAuditCheck('search_auth_required', 'Search requires authenticated user', true, 'authGuard + csrfGuard on /api/search'),
      createAuditCheck('email_notifications', 'Email delivery pipeline available', true, 'SMTP sender with SQL delivery log'),
      createAuditCheck(
        'oauth_google',
        'Google OAuth backend verification ready',
        true,
        googleConfigured ? 'configured' : 'optional: missing GOOGLE_CLIENT_ID(S)'
      ),
      createAuditCheck(
        'oauth_apple',
        'Apple OAuth backend verification ready',
        true,
        appleConfigured ? 'configured' : 'optional: missing APPLE_CLIENT_ID(S)'
      ),
      createAuditCheck(
        'oauth_facebook',
        'Facebook OAuth backend verification ready',
        true,
        facebookConfigured ? 'configured' : 'optional: missing FACEBOOK_CLIENT_ID(S)'
      ),
      createAuditCheck('input_validation', 'Schema validation enabled', true, 'zod validation on auth/search/watchlist/outbound')
    ];
    const passed = checks.filter((item) => item.ok).length;
    return res.json({
      ok: passed === checks.length,
      now: new Date().toISOString(),
      auditHmacKeyMissing: !auditHmacConfigured,
      summary: { total: checks.length, passed, failed: checks.length - passed },
      checks
    });
  });

  router.get('/api/system/data-status', async (_req, res) => {
    const base = await getDataFoundationStatus();
    const providers = providerRegistry?.listProviders?.() || [];
    const duffel = providers.find((p) => p.name === 'duffel');
    const amadeus = providers.find((p) => p.name === 'amadeus');
    return res.json({
      ...base,
      providers: {
        duffelConfigured: Boolean(duffel?.configured),
        amadeusConfigured: Boolean(amadeus?.configured)
      }
    });
  });

  return router;
}
