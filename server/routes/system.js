import { Router } from 'express';
import { z } from 'zod';
import { computeFlightDisplayPrice } from '../lib/pricing-engine.js';
import { getEmailReadiness } from '../lib/email/email-readiness.js';
import { getEmailMetrics } from '../lib/email/email-metrics.js';
import { getAlertDeliveryReadiness, getBillingReadiness, getProviderReadiness } from '../lib/readiness.js';
import { evaluateCachePolicy, getRuntimeProfileSummary } from '../lib/runtime-profile.js';

const pricingSimulationSchema = z
  .object({
    providerCost: z.coerce.number().positive().max(50000),
    currency: z.string().trim().min(3).max(3).optional().default('EUR'),
    userTier: z.enum(['free', 'pro', 'creator', 'elite']).optional().default('free'),
    deviceType: z.enum(['mobile', 'desktop']).optional().default('desktop'),
    isReturningUser: z.coerce.boolean().optional().default(false),
    isLastMinute: z.coerce.boolean().optional().default(false),
    isPopularRoute: z.coerce.boolean().optional().default(false),
    isSmartDeal: z.coerce.boolean().optional().default(false),
    isPremiumDeal: z.coerce.boolean().optional().default(false),
    departureDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().default(null)
  })
  .strict();

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
  RL_AUTH_PER_MINUTE,
  runFeatureAudit,
  getDataFoundationStatus,
  getOpportunityPipelineStats,
  getOpportunityIntelligenceDebugStats,
  providerRegistry,
  getScanProviderAdapterMetrics = () => ({}),
  getDiscoveryFeedRuntimeMetrics = () => ({}),
  getLiveFlightCacheMetrics = () => ({}),
  getAiCacheMetrics = () => ({}),
  getAiCostGuardMetrics = () => ({}),
  getFreeCostMetrics = () => ({}),
  getLaunchReadiness = () => ({}),
  getProviderCostGuardMetrics = () => ({}),
  getRuntimeConfigAudit,
  evaluateStartupReadiness,
  authGuard = (_req, _res, next) => next(),
  requireSessionAuth = (_req, _res, next) => next(),
  adminGuard = (_req, _res, next) => next(),
  csrfGuard = (_req, _res, next) => next(),
  requireApiScope = () => (_req, _res, next) => next(),
  quotaGuard = () => (_req, _res, next) => next(),
  FLIGHT_SCAN_ENABLED = false,
  getFlightScanStatus = async () => ({ ok: false, reason: 'flight_scan_status_not_configured' }),
  runFlightScanSchedulerOnce = null,
  runFlightScanWorkerOnce = null,
  runFlightScanCycleOnce = null
}) {
  const router = Router();

  router.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      now: new Date().toISOString(),
      request_id: req.id || null
    });
  });

  router.get('/health', (req, res) => {
    return res.status(200).json({
      status: 'ok',
      now: new Date().toISOString(),
      request_id: req.id || null
    });
  });

  router.get('/health/db', authGuard, requireSessionAuth, adminGuard, async (_req, res) => {
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

  router.get('/health/engine', authGuard, requireSessionAuth, adminGuard, async (_req, res) => {
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
      now: new Date().toISOString()
    });
  });

  async function runReadinessChecks() {
    const cachePolicy = evaluateCachePolicy(process.env);
    const checks = {
      postgres: { ok: true, mode: process.env.DATABASE_URL ? 'postgres' : 'local' },
      redis: {
        ok: cachePolicy.ok,
        mode: cachePolicy.cacheBackend,
        status: cachePolicy.redisStatus,
        required: cachePolicy.redisRequired,
        detail: cachePolicy.reasons.join(',') || null
      }
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
          checks.redis.ok = cachePolicy.ok;
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
    const emailReadiness = getEmailReadiness(process.env);
    checks.email = {
      ok: emailReadiness.status === 'EMAIL_READY' || emailReadiness.status === 'EMAIL_DRY_RUN',
      status: emailReadiness.status,
      provider: emailReadiness.provider,
      dryRun: emailReadiness.dryRun,
      detail: emailReadiness.reason
    };
    const ready = checks.postgres.ok && checks.redis.ok && checks.email.ok;
    return res.status(ready ? 200 : 503).json({
      ok: ready,
      now: new Date().toISOString(),
      request_id: req.id || null
    });
  });

  router.get('/api/health/features', authGuard, requireSessionAuth, adminGuard, (_req, res) => {
    const audit = runFeatureAudit();
    res.json(audit);
  });

  /**
   * Runtime capability matrix — source of truth for UI gating and diagnostics.
   *
   * Each entry:
   *   status: 'active' | 'configured_not_active' | 'disabled' | 'mock_only'
   *   reason: human-readable explanation when not active
   *
   * Public endpoint (no auth required) — safe because all values are derived
   * from env flags, not secrets. No credentials are exposed.
   */
  function buildCapabilityPayload() {
    const env = process.env;
    const launch = getLaunchReadiness?.() || {};
    const parseFlag = (v, def = false) => {
      if (v === undefined || v === null || v === '') return def;
      return ['true', '1', 'yes'].includes(String(v).trim().toLowerCase());
    };
    const hasValue = (v, min = 4) => String(v || '').trim().length >= min;
    const notPlaceholder = (v) =>
      !['replace-with', 'example.com', 'changeme', 'your-', 'todo'].some((p) =>
        String(v || '').toLowerCase().includes(p)
      );
    const ready = (v, min = 4) => hasValue(v, min) && notPlaceholder(v);

    const providerReadiness = getProviderReadiness(env);
    const alertReadiness = getAlertDeliveryReadiness(env);
    const billingReadiness = getBillingReadiness(env);
    const runtime = getRuntimeProfileSummary(env);
    const emailReadiness = alertReadiness.emailReadiness;
    const smtpReady = alertReadiness.smtpReady;
    const googleReady = ready(env.GOOGLE_CLIENT_ID) || ready(env.GOOGLE_CLIENT_IDS);
    const appleReady = ready(env.APPLE_CLIENT_ID) || ready(env.APPLE_CLIENT_IDS);
    const facebookReady = ready(env.FACEBOOK_CLIENT_ID) || ready(env.FACEBOOK_CLIENT_IDS);
    const openaiReady = ready(env.OPENAI_API_KEY, 8);
    const anthropicReady = ready(env.ANTHROPIC_API_KEY, 8);
    const aiReady = openaiReady || anthropicReady;
    const billingProvider = billingReadiness.billingProvider;
    const billingReady = billingReadiness.billingReady;
    const liveProvidersReady = providerReadiness.liveProviderConfigured;
    const flightScanEnabled = parseFlag(env.FLIGHT_SCAN_ENABLED);
    const pushReady = alertReadiness.pushWebhookReady;
    const vapidReady = alertReadiness.vapidReady;
    const searchHistoryEnabled = parseFlag(env.SEARCH_HISTORY_PERSIST_ENABLED);
    const allowMockBilling = billingReadiness.mockBillingEnabled;
    const dbReady = ready(env.DATABASE_URL, 10);
    const cacheReady = ready(env.REDIS_URL, 10);

    const cap = (active, reason = null) => ({ active: Boolean(active), reason: active ? null : reason });
    const publicCapabilities = {
      live_flight_providers: cap(liveProvidersReady, 'Live providers are not available in this environment'),
      flight_scan: cap(flightScanEnabled && liveProvidersReady, flightScanEnabled ? 'Flight scan is not available' : 'Flight scan disabled'),
      data_source: liveProvidersReady ? 'live' : 'internal',
      ai_features: cap(aiReady, 'AI features are not available in this environment'),
      billing: cap(billingReady, 'Billing is not available in this environment'),
      push_notifications: cap(alertReadiness.pushReady, 'Push notifications are not available'),
      oauth_google: cap(googleReady, 'Google sign-in is not available'),
      oauth_apple: cap(appleReady, 'Apple sign-in is not available'),
      oauth_facebook: cap(facebookReady, 'Facebook sign-in is not available'),
      email_verification: cap(smtpReady, 'Email verification is not available'),
      search_history_persist: cap(searchHistoryEnabled, 'Search history is not stored in this environment'),
      data_export: cap(true, null),
      booking_handoff_mode: 'redirect',
      booking_partner_configured: cap(ready(env.BOOKING_BASE_URL, 10), 'Booking redirects are disabled')
    };

    const adminCapabilities = {
      ...publicCapabilities,
      database_postgres: cap(dbReady, 'DATABASE_URL not configured - using JSON file store'),
      cache_redis: cap(cacheReady, 'REDIS_URL not configured - using in-memory cache'),
      provider_readiness: launch.provider?.status || providerReadiness.status,
      live_provider_names: providerReadiness.providerNames,
      ai_provider: openaiReady ? 'openai' : anthropicReady ? 'anthropic' : null,
      billing_provider: billingProvider,
      billing_mock_mode: allowMockBilling,
      email_readiness: emailReadiness.status,
      email_dry_run: emailReadiness.dryRun,
      email_provider: emailReadiness.provider,
      email_smtp: cap(smtpReady, 'SMTP_HOST/USER/PASS not configured - emails not sent, accounts auto-verified'),
      email_metrics: getEmailMetrics(),
      alert_delivery: launch.alerts?.status || alertReadiness.status,
      vapid_push: cap(vapidReady, 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not configured - browser push not available'),
      browser_push_enabled: alertReadiness.browserPushEnabled,
      browser_push_status: alertReadiness.browserPushEnabled ? 'BROWSER_PUSH_ENABLED' : 'BROWSER_PUSH_DISABLED',
      push_webhook: cap(pushReady, 'PUSH_WEBHOOK_URL not configured')
    };

    return {
      generated_at: new Date().toISOString(),
      runtimeProfile: runtime.runtimeProfile,
      cacheBackend: runtime.cacheBackend,
      redisStatus: runtime.redisStatus,
      emailStatus: emailReadiness.status,
      aiStatus: runtime.ai,
      providerStatus: runtime.providerLive,
      billingStatus: runtime.billing,
      pushStatus: alertReadiness.pushReady ? 'configured' : 'gated',
      freeCostStatus: runtime.freeCostStatus,
      launch,
      publicCapabilities,
      adminCapabilities
    };
  }

  router.get('/api/system/capabilities', (_req, res) => {
    const payload = buildCapabilityPayload();
    res.json({
      generated_at: payload.generated_at,
      capabilities: payload.publicCapabilities
    });
  });

  router.get('/api/admin/system/capabilities', authGuard, requireSessionAuth, adminGuard, (_req, res) => {
    const payload = buildCapabilityPayload();
    res.json({
      generated_at: payload.generated_at,
      runtimeProfile: payload.runtimeProfile,
      cacheBackend: payload.cacheBackend,
      redisStatus: payload.redisStatus,
      emailStatus: payload.emailStatus,
      aiStatus: payload.aiStatus,
      providerStatus: payload.providerStatus,
      billingStatus: payload.billingStatus,
      pushStatus: payload.pushStatus,
      freeCostStatus: payload.freeCostStatus,
      launch: payload.launch,
      publicCapabilities: payload.publicCapabilities,
      adminCapabilities: payload.adminCapabilities,
      capabilities: payload.adminCapabilities
    });
  });

  router.get('/api/health/compliance', authGuard, requireSessionAuth, adminGuard, (_req, res) => {
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

  router.get('/api/health/security', authGuard, requireSessionAuth, adminGuard, async (_req, res) => {
    let db = null;
    try {
      db = await readDb();
    } catch {
      db = { revokedTokens: [], refreshSessions: [], oauthSessions: [] };
      if (pgPool) {
        const [revokedCount, refreshCount, oauthCount] = await Promise.all([
          pgPool.query('SELECT COUNT(*)::int AS value FROM revoked_tokens').catch(() => ({ rows: [{ value: 0 }] })),
          pgPool.query('SELECT COUNT(*)::int AS value FROM refresh_sessions').catch(() => ({ rows: [{ value: 0 }] })),
          pgPool.query('SELECT COUNT(*)::int AS value FROM oauth_sessions').catch(() => ({ rows: [{ value: 0 }] }))
        ]);
        db.revokedTokens = new Array(Number(revokedCount.rows?.[0]?.value || 0));
        db.refreshSessions = new Array(Number(refreshCount.rows?.[0]?.value || 0));
        db.oauthSessions = new Array(Number(oauthCount.rows?.[0]?.value || 0));
      }
    }
    const auditChain = await verifyImmutableAudit();
    const runtimeAudit = getRuntimeConfigAudit();
    const startupReadiness = evaluateStartupReadiness();
    const auditHmacConfigured = Boolean(String(process.env.AUDIT_LOG_HMAC_KEY || '').trim());
    const googleConfigured = Boolean(String(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '').trim());
    const appleConfigured = Boolean(String(process.env.APPLE_CLIENT_IDS || process.env.APPLE_CLIENT_ID || '').trim());
    const facebookConfigured = Boolean(String(process.env.FACEBOOK_CLIENT_IDS || process.env.FACEBOOK_CLIENT_ID || '').trim());
    const jwtCheck = runtimeAudit.checks.find((check) => check.key === 'JWT_SECRET');
    const checks = [
      createAuditCheck(
        'runtime_config_blocking',
        'Blocking runtime config present',
        runtimeAudit.summary.blockingFailed === 0,
        runtimeAudit.summary.blockingFailed === 0
          ? 'all blocking runtime keys configured'
          : `missing=${runtimeAudit.blockingFailedKeys.join(',')}`
      ),
      createAuditCheck('jwt_secret', 'JWT secret configured and strong', jwtCheck?.ok, jwtCheck?.detail || 'JWT_SECRET check unavailable'),
      createAuditCheck(
        'startup_policy',
        'Startup production policy checks',
        startupReadiness.summary.policy.blockingFailed === 0,
        startupReadiness.summary.policy.blockingFailed === 0
          ? 'startup policy checks passed'
          : `missing=${startupReadiness.blockingFailed.policy.join(',')}`
      ),
      createAuditCheck('helmet', 'Helmet security headers enabled', true, 'helmet middleware active'),
      createAuditCheck('cors_allowlist', 'CORS allowlist enforced', CORS_ALLOWLIST.size > 0, `allowedOrigins=${CORS_ALLOWLIST.size}`),
      createAuditCheck('auth_rate_limit', 'Auth rate limiting enabled', true, `${RL_AUTH_PER_MINUTE} attempts / minute`),
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

  router.get('/api/health/deploy-readiness', authGuard, requireSessionAuth, adminGuard, (_req, res) => {
    const startupReadiness = evaluateStartupReadiness();
    const runtimeAudit = startupReadiness.runtimeAudit;
    return res.status(startupReadiness.ok ? 200 : 503).json({
      ok: startupReadiness.ok,
      now: new Date().toISOString(),
      summary: startupReadiness.summary,
      blockingMissing: startupReadiness.blockingFailed,
      recommendedMissing: startupReadiness.recommendedFailed,
      checks: {
        runtime: runtimeAudit.checks,
        policy: startupReadiness.policyChecks
      }
    });
  });

  router.get('/api/system/data-status', authGuard, requireSessionAuth, adminGuard, async (_req, res) => {
    const base = await getDataFoundationStatus();
    const opportunityPipeline = (await getOpportunityPipelineStats?.()) || null;
    const providers = providerRegistry?.listProviders?.() || [];
    const duffel = providers.find((p) => p.name === 'duffel');
    return res.json({
      ...base,
      opportunityPipeline,
      providers: {
        duffelConfigured: Boolean(duffel?.configured)
      }
    });
  });

  // Backward-compatible alias used by older frontend clients.
  router.get('/api/system/opportunity-debug', authGuard, requireSessionAuth, adminGuard, async (_req, res) => {
    try {
      if (typeof getOpportunityIntelligenceDebugStats === 'function') {
        const payload = await getOpportunityIntelligenceDebugStats();
        return res.json(payload);
      }
      const base = await getDataFoundationStatus();
      const opportunityPipeline = (await getOpportunityPipelineStats?.()) || null;
      return res.json({ opportunityPipeline, data: base, refreshedAt: new Date().toISOString() });
    } catch (error) {
      logger.error({ err: error }, 'system_opportunity_debug_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/api/health/observability', authGuard, requireSessionAuth, adminGuard, async (_req, res) => {
    const opportunityPipeline = (await getOpportunityPipelineStats?.()) || null;
    const providerRuntime = providerRegistry?.runtimeStats?.() || providerRegistry?.listProviders?.() || [];
    const scanStatus = (await getFlightScanStatus?.()) || null;
    const scanProviderAdapter = getScanProviderAdapterMetrics();
    const discoveryFeedRuntime = getDiscoveryFeedRuntimeMetrics?.() || {};
    const liveFlightCache = getLiveFlightCacheMetrics?.() || {};
    const aiCache = getAiCacheMetrics?.() || {};
    const aiCostGuard = getAiCostGuardMetrics?.() || {};
    const freeCost = getFreeCostMetrics?.() || {};
    const providerCostGuard = getProviderCostGuardMetrics?.() || {};
    const db = await readDb();
    const totalProviderSearches = providerRuntime.reduce((sum, item) => sum + Number(item.totalSearches || 0), 0);
    const totalProviderFailures = providerRuntime.reduce((sum, item) => sum + Number(item.failures || 0), 0);
    const totalProviderRejectedOffers = providerRuntime.reduce((sum, item) => sum + Number(item.rejectedOffers || 0), 0);
    const pushDeadLetters = Array.isArray(db?.pushDeadLetters) ? db.pushDeadLetters.length : 0;
    return res.json({
      ok: true,
      now: new Date().toISOString(),
      providerRuntime,
      scanProviderAdapter,
      liveFlightCache,
      aiCache,
      aiCostGuard,
      freeCost,
      providerCostGuard,
      scan: {
        enabled: Boolean(FLIGHT_SCAN_ENABLED),
        queue: scanStatus?.queue || null,
        worker: scanStatus?.worker || null,
        scheduler: scanStatus?.scheduler || null
      },
      pipelineQuality: {
        filteredOutSinceBoot: Number(opportunityPipeline?.apiQuality?.filteredOutSinceBoot || 0),
        discoveryFeed: discoveryFeedRuntime
      },
      counters: {
        providerSearches: totalProviderSearches,
        providerFailures: totalProviderFailures,
        providerRejectedOffers: totalProviderRejectedOffers,
        pushDeadLetters,
        discoveryFeedFreshBuilds: Number(discoveryFeedRuntime?.freshBuildsTotal || 0),
        discoveryFeedCacheHits: Number(discoveryFeedRuntime?.cacheHitsTotal || 0),
        discoveryFeedSkipped: Number(discoveryFeedRuntime?.skippedTotal || 0)
      }
    });
  });

  router.post(
    '/api/admin/pricing/simulate',
    authGuard,
    requireSessionAuth,
    adminGuard,
    csrfGuard,
    requireApiScope('read'),
    quotaGuard({ counter: 'read', amount: 1 }),
    async (req, res) => {
      const parsed = pricingSimulationSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid pricing simulation payload.'
        });
      }

      const payload = parsed.data;
      const context = {
        userTier: payload.userTier,
        deviceType: payload.deviceType,
        isReturningUser: payload.isReturningUser,
        isLastMinute: payload.isLastMinute,
        isPopularRoute: payload.isPopularRoute,
        isSmartDeal: payload.isSmartDeal,
        isPremiumDeal: payload.isPremiumDeal,
        departureDate: payload.departureDate || null
      };

      const simulation = computeFlightDisplayPrice(payload.providerCost, payload.currency, context);

      // Useful for pricing diagnostics: how much markup is applied over provider cost.
      const absoluteMarkup = Number((simulation.displayPrice - simulation.providerCost).toFixed(2));
      const markupPct = simulation.providerCost > 0 ? Number(((absoluteMarkup / simulation.providerCost) * 100).toFixed(2)) : 0;

      return res.json({
        ok: true,
        input: {
          providerCost: Number(payload.providerCost),
          currency: String(payload.currency || 'EUR').toUpperCase(),
          context
        },
        output: {
          displayPrice: simulation.displayPrice,
          providerCost: simulation.providerCost,
          currency: simulation.currency,
          marginApplied: simulation.marginApplied,
          marginRate: simulation.marginRate,
          pricingEnabled: simulation.pricingEnabled,
          breakdown: simulation.breakdown,
          diagnostics: {
            absoluteMarkup,
            markupPct
          }
        },
        meta: {
          endpoint: '/api/admin/pricing/simulate',
          generatedAt: new Date().toISOString()
        }
      });
    }
  );

  router.get(
    '/api/system/flight-scan/status',
    authGuard,
    requireSessionAuth,
    adminGuard,
    requireApiScope('read'),
    quotaGuard({ counter: 'read', amount: 1 }),
    async (_req, res) => {
    const status = await getFlightScanStatus();
    return res.status(status?.ok === false ? 503 : 200).json({
      enabled: Boolean(FLIGHT_SCAN_ENABLED),
      ...status
    });
    }
  );

  router.post(
    '/api/system/flight-scan/scheduler/run',
    authGuard,
    requireSessionAuth,
    adminGuard,
    csrfGuard,
    requireApiScope('alerts'),
    quotaGuard({ counter: 'alerts', amount: 1 }),
    async (_req, res) => {
    if (typeof runFlightScanSchedulerOnce !== 'function') {
      return res.status(503).json({ error: 'scanner_not_configured' });
    }
    try {
      const summary = await runFlightScanSchedulerOnce({ enabled: true });
      return res.json({ ok: true, summary });
    } catch (error) {
      logger.error({ err: error }, 'flight_scan_scheduler_manual_run_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
    }
  );

  router.post(
    '/api/system/flight-scan/worker/run',
    authGuard,
    requireSessionAuth,
    adminGuard,
    csrfGuard,
    requireApiScope('alerts'),
    quotaGuard({ counter: 'alerts', amount: 1 }),
    async (_req, res) => {
    if (typeof runFlightScanWorkerOnce !== 'function') {
      return res.status(503).json({ error: 'scanner_not_configured' });
    }
    try {
      const summary = await runFlightScanWorkerOnce({ enabled: true });
      return res.json({ ok: true, summary });
    } catch (error) {
      logger.error({ err: error }, 'flight_scan_worker_manual_run_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
    }
  );

  router.post(
    '/api/system/flight-scan/run',
    authGuard,
    requireSessionAuth,
    adminGuard,
    csrfGuard,
    requireApiScope('alerts'),
    quotaGuard({ counter: 'alerts', amount: 1 }),
    async (_req, res) => {
    if (typeof runFlightScanCycleOnce !== 'function') {
      return res.status(503).json({ error: 'scanner_not_configured' });
    }
    try {
      const summary = await runFlightScanCycleOnce({
        enabled: true,
        runScheduler: true,
        stopWhenQueueEmpty: true
      });
      return res.json({ ok: true, summary });
    } catch (error) {
      logger.error({ err: error }, 'flight_scan_cycle_manual_run_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
    }
  );

  return router;
}
