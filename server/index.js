import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { nanoid } from 'nanoid';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { addDays } from 'date-fns';
import worldCountries from 'world-countries';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { hashPassword, signAccessToken, signRefreshToken, verifyAccessToken, verifyPassword, verifyRefreshToken } from './lib/auth.js';
import { buildBookingLink, decideTrips, getDestinationSuggestions, searchFlights } from './lib/flight-engine.js';
import { buildAllAffiliateLinks } from './lib/affiliate-links.js';
import { readDb, withDb } from './lib/db.js';
import { appendImmutableAudit, verifyImmutableAudit } from './lib/audit-log.js';
import { getBusinessMetrics, getFunnelMetricsByChannel, initSqlDb, insertEmailDeliveryLog, insertSearchEvent, upsertUserLead } from './lib/sql-db.js';
import { sendMail } from './lib/mailer.js';
import { exchangeAppleCodeForTokens, exchangeFacebookCodeForProfile, exchangeGoogleCodeForTokens, verifyAppleIdToken, verifyGoogleIdToken } from './lib/oauth.js';
import { DESTINATIONS, ORIGINS } from './data/flights-data.js';
import pg from 'pg';
import { getOrCreateSubscription, getPricingConfig, PLANS, setSaasPool, grantPremiumTrial, checkAndExpireTrial } from './lib/saas-db.js';
import { quotaGuard, apiKeyAuth, requireApiScope } from './middleware/quotaGuard.js';
import { buildApiKeysRouter } from './routes/apikeys.js';
import { buildBillingRouter } from './routes/billing.js';
import { buildUsageRouter } from './routes/usage.js';
import { buildFreeFoundationRouter } from './routes/free-foundation.js';
import { buildDealEngineRouter } from './routes/deal-engine.js';
import { buildDiscoveryRouter } from './routes/discovery.js';
import { buildOpportunitiesRouter } from './routes/opportunities.js';
import { buildOutboundRouter } from './routes/outbound.js';
import { buildUserExportRouter } from './routes/user-export.js';
import { renderPrivacyPolicy, renderCookiePolicy, renderTermsOfService } from './lib/legal-pages.js';
import { buildAlertsRouter } from './routes/alerts.js';
import { buildSystemRouter } from './routes/system.js';
import { buildSearchRouter } from './routes/search.js';
import { buildAuthSessionRouter } from './routes/auth-session.js';
import { buildAuthLocalRouter } from './routes/auth-local.js';
import { buildAuthOAuthRouter } from './routes/auth-oauth.js';
import { buildPushRouter } from './routes/push.js';
import { buildAdminTelemetryRouter } from './routes/admin-telemetry.js';
import { buildPublicUtilityRouter } from './routes/public-utility.js';
import { startRuntimeLifecycle } from './bootstrap/runtime-lifecycle.js';
import { createRuntimeAppContext } from './bootstrap/app-context.js';
import { createDomainServices } from './bootstrap/domain-services.js';
import { createAuthRuntime } from './bootstrap/auth-runtime.js';
import { enforceStartupReadinessOrFail, logStartupCapabilityWarnings, verifyPrimaryInfrastructureOrFail } from './bootstrap/startup-guards.js';
import { runNightlyFreePrecompute } from './jobs/free-precompute.js';
import { runFreeAlertWorkerOnce } from './jobs/free-alert-worker.js';
import { runNightlyRouteBaselineJob } from './jobs/route-baselines.js';
import { runDiscoveryAlertWorkerOnce } from './jobs/discovery-alert-worker.js';
import { runPriceIngestionWorkerOnce } from './lib/price-ingestion-worker.js';
import { getPriceDatasetStatus, initPriceHistoryStore } from './lib/price-history-store.js';
import { runBaselineRecomputeOnce } from './jobs/baseline-recompute-worker.js';
import { runProviderCollectionOnce } from './jobs/provider-collection-worker.js';
import { runSeedImportOnce } from './jobs/seed-import-worker.js';
import { runOpportunityPipelineOnce } from './jobs/opportunity-pipeline-worker.js';
import { runRadarMatchPrecomputeOnce } from './jobs/radar-match-precompute-worker.js';
import { runFlightScanCycleOnce, runFlightScanSchedulerOnce, runFlightScanWorkerOnce } from './jobs/flight-scan-worker.js';
import { runDetectedDealsWorkerOnce } from './jobs/detected-deals-worker.js';
import { runRoutePriceStatsWorkerOnce } from './jobs/route-price-stats-worker.js';
import { runPriceAlertsWorkerOnce } from './jobs/price-alerts-worker.js';
import { runDealsContentWorkerOnce } from './jobs/deals-content-worker.js';
import { captureUserPriceObservation } from './lib/observation-capture.js';
import { closeCacheClient, getCacheClient } from './lib/cache/index.js';
import { createFlightProviderRegistry, createProviderRegistry } from './lib/providers/index.js';
import { createLiveFlightService } from './lib/live-flight-service.js';
import { getScanProviderAdapterMetrics } from './lib/scan/provider-adapter.js';
import { createScanStatusService } from './lib/scan/scan-status-service.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { buildErrorPayload, errorHandler, getErrorCode, getHumanErrorMessage } from './middleware/error-handler.js';
import { createPayloadHardeningMiddleware, safeJsonByteLength } from './middleware/payload-hardening.js';
import { getProviderCostGuardMetrics, logger, requestLogger } from './lib/observability/index.js';
import { anonymizeIpForLogs, hashValueForLogs, redactUrlForLogs } from './lib/log-redaction.js';
import { getDataFoundationStatus, runIngestionJobsMaintenance } from './lib/deal-engine-store.js';
import { getFollowSignalsSummary, getOpportunityIntelligenceDebugStats, getOpportunityPipelineStats } from './lib/opportunity-store.js';
import { getDiscoveryFeedRuntimeMetrics } from './lib/discovery-feed-service.js';
import { getRuntimeConfigAudit } from './lib/runtime-config.js';
import { evaluateStartupReadiness } from './lib/startup-readiness.js';
import { getAiCacheMetrics, getAiCostGuardMetrics } from './lib/ai/index.js';
import { loadServerRuntimeConfig } from './lib/server-runtime-config.js';
import {
  getAccessTokenFromCookie as readAccessTokenFromCookie,
  getAuthToken as resolveRequestAuthToken,
  getCookies,
  getRefreshTokenFromCookie as readRefreshTokenFromCookie
} from './lib/auth-request-utils.js';
import { buildDestinationInsights } from './lib/destination-insights.js';
import { canUseAITravel, canUseRadar, getUpgradeContext, resolveUserPlan } from './lib/gating/index.js';
import { buildAdminBackofficeReport } from './lib/admin-backoffice-report.js';
import { getCostCapMonitoringSnapshot } from './lib/cost-cap-monitor.js';
import { createAuditCheck, runFeatureAudit as runFeatureAuditModule } from './lib/feature-audit.js';
import {
  CABIN_ENUM,
  CONNECTION_ENUM,
  REGION_ENUM,
  TRAVEL_TIME_ENUM,
  adminTelemetryEventSchema,
  alertSubscriptionSchema,
  alertSubscriptionUpdateSchema,
  decisionIntakeSchema,
  destinationInsightSchema,
  emailVerifySchema,
  justGoSchema,
  loginMfaVerifySchema,
  loginSchema,
  mfaCodeSchema,
  onboardingCompleteSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerSchema,
  searchSchema,
  watchlistSchema
} from './lib/request-schemas.js';

dotenv.config();
try {
  await initSqlDb();
} catch (error) {
  logger.fatal({ err: error }, 'startup_init_sql_db_failed');
  process.exit(1);
}
await initPriceHistoryStore();

// Wire Postgres pool into saas-db when DATABASE_URL is configured
const pgPool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
if (pgPool) {
  setSaasPool(pgPool);
}

const app = express();
let runtimeConfig;
try {
  runtimeConfig = loadServerRuntimeConfig({ env: process.env, logger });
} catch {
  process.exit(1);
}

const {
  PORT,
  CRON_SCHEDULE,
  LOGIN_MAX_FAILURES,
  LOGIN_LOCK_MINUTES,
  OAUTH_SESSION_TTL_SECONDS,
  FRONTEND_URL,
  GOOGLE_OAUTH_REDIRECT_URI,
  APPLE_OAUTH_REDIRECT_URI,
  FACEBOOK_OAUTH_REDIRECT_URI,
  AI_PRICING_CRON,
  AI_PRICING_CRON_TIMEZONE,
  AI_TARGET_MARGIN,
  AI_USAGE_GROWTH_FACTOR,
  AI_PLATFORM_OVERHEAD_EUR,
  AI_SAFETY_BUFFER_EUR,
  AI_COST_FEED_URL,
  FREE_PRECOMPUTE_CRON,
  FREE_ALERT_WORKER_CRON,
  FREE_JOBS_TIMEZONE,
  DEAL_BASELINE_CRON,
  DEAL_BASELINE_CRON_TIMEZONE,
  DISCOVERY_ALERT_WORKER_CRON,
  DISCOVERY_ALERT_WORKER_TIMEZONE,
  PRICE_INGEST_WORKER_CRON,
  PRICE_INGEST_WORKER_TIMEZONE,
  PROVIDER_COLLECTION_ENABLED,
  SCAN_PROVIDER_OVERLAP_POLICY,
  PROVIDER_COLLECTION_CRON,
  PROVIDER_COLLECTION_TIMEZONE,
  OPPORTUNITY_PIPELINE_CRON,
  OPPORTUNITY_PIPELINE_TIMEZONE,
  INGESTION_JOBS_MAINTENANCE_CRON,
  INGESTION_JOBS_MAINTENANCE_TIMEZONE,
  ROUTE_PRICE_STATS_ENABLED,
  ROUTE_PRICE_STATS_CRON,
  ROUTE_PRICE_STATS_TIMEZONE,
  DETECTED_DEALS_ENABLED,
  DETECTED_DEALS_CRON,
  DETECTED_DEALS_TIMEZONE,
  DEALS_CONTENT_ENABLED,
  DEALS_CONTENT_CRON,
  DEALS_CONTENT_TIMEZONE,
  DEALS_CONTENT_RUN_ON_STARTUP,
  PRICE_ALERTS_ENABLED,
  PRICE_ALERTS_CRON,
  PRICE_ALERTS_TIMEZONE,
  PRICE_ALERTS_WORKER_LIMIT,
  RADAR_MATCH_PRECOMPUTE_CRON,
  RADAR_MATCH_PRECOMPUTE_TIMEZONE,
  FLIGHT_SCAN_ENABLED,
  FLIGHT_SCAN_SCHEDULER_CRON,
  FLIGHT_SCAN_WORKER_CRON,
  FLIGHT_SCAN_TIMEZONE,
  BOOTSTRAP_SEED_IMPORT_FILE,
  BOOTSTRAP_SEED_IMPORT_DRY_RUN,
  JSON_BODY_LIMIT,
  BUILD_VERSION,
  NODE_ENV,
  OUTBOUND_CLICK_SECRET,
  OUTBOUND_CLICK_TTL_SECONDS,
  ADMIN_TELEMETRY_MAX_BODY_BYTES,
  ADMIN_TELEMETRY_ALLOWED_SKEW_MS,
  ADMIN_TELEMETRY_DEDUPE_WINDOW_MS,
  API_MAX_BODY_BYTES,
  AUTH_MAX_BODY_BYTES,
  OUTBOUND_MAX_BODY_BYTES,
  OUTBOUND_MAX_QUERY_CHARS,
  PAYLOAD_MAX_DEPTH,
  PAYLOAD_MAX_NODES,
  PAYLOAD_MAX_ARRAY_LENGTH,
  PAYLOAD_MAX_OBJECT_KEYS,
  PAYLOAD_MAX_STRING_LENGTH,
  PAYLOAD_MAX_KEY_LENGTH,
  TELEMETRY_BURST_WINDOW_MS,
  TELEMETRY_BURST_MAX,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  OAUTH_BINDING_COOKIE_NAME,
  ACCESS_COOKIE_TTL_MS,
  REFRESH_COOKIE_TTL_MS,
  AUTH_COOKIE_DOMAIN,
  CORS_ALLOWLIST,
  ADMIN_ALLOWLIST_EMAILS,
  ADMIN_DASHBOARD_ENABLED,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  RL_AUTH_PER_MINUTE,
  RL_OUTBOUND_PER_MINUTE,
  RL_OUTBOUND_PER_SECOND,
  RL_TELEMETRY_PER_SECOND,
  AUTH_REQUIRE_TRUSTED_ORIGIN,
  AUTH_RETURN_ACCESS_TOKEN,
  REGISTRATION_ENABLED,
  LEGACY_AUTH_ROUTES_ENABLED,
  MOCK_BILLING_UPGRADES_ENABLED,
  RUNTIME_MODE,
  RUN_STARTUP_TASKS,
  CRON_RETRY_ATTEMPTS,
  CRON_RETRY_DELAY_MS,
  SUBSCRIPTION_SCAN_CACHE_TTL_SEC,
  SUBSCRIPTION_SCAN_LOCK_TTL_SEC,
  SHUTDOWN_TIMEOUT_MS,
  ALLOW_INSECURE_STARTUP_FOR_TESTS,
  ALLOW_INSECURE_STARTUP_IN_PRODUCTION,
  INSECURE_STARTUP_BYPASS_ENABLED,
  REQUIRE_PRIMARY_INFRA_IN_PRODUCTION,
  PRIMARY_INFRA_CHECK_TIMEOUT_MS,
  LOGIN_DUMMY_PASSWORD_HASH,
  TRUST_PROXY
} = runtimeConfig;

app.set('trust proxy', TRUST_PROXY);

// Redirect plain HTTP to HTTPS in production. Must come before all routes.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.secure) return next();
    // x-forwarded-proto is trusted because trust proxy is set above
    if (req.headers['x-forwarded-proto'] === 'https') return next();
    return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
  });
}

app.use(requestIdMiddleware);
app.use(requestLogger);
app.use((req, res, next) => {
  res.on('finish', () => {
    if (![401, 403, 429].includes(res.statusCode)) return;
    logger.warn(
      {
        request_id: req.id || null,
        method: req.method,
        path: redactUrlForLogs(req.originalUrl || req.url, { maxLength: 220 }),
        status: res.statusCode,
        ip_hash: anonymizeIpForLogs(req.ip || req.socket?.remoteAddress || '')
      },
      'security_event'
    );
  });
  next();
});
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
      const normalized = { ...body };
      const status = res.statusCode;
      const rawError = String(normalized.error || '').trim();
      const rawLooksLikeCode = /^[a-z0-9_]+$/i.test(rawError);
      const code = getErrorCode(rawError || normalized.message || normalized.error, status);
      normalized.error = code;
      if (!normalized.message) {
        const validationMessage = !rawLooksLikeCode ? rawError : '';
        normalized.message = getHumanErrorMessage(code, validationMessage);
      }
      if (normalized.error && !normalized.request_id) {
        normalized.request_id = req.id || null;
      }
      if (normalized.reset_at) {
        const parsed = new Date(normalized.reset_at);
        if (!Number.isNaN(parsed.getTime())) normalized.reset_at = parsed.toISOString();
      }
      return originalJson(normalized);
    }
    return originalJson(body);
  };
  next();
});
app.use((req, res, next) => {
  const accept = String(req.headers.accept || '').toLowerCase();
  const isHtmlRequest = accept.includes('text/html') && !req.path.startsWith('/api/');
  res.locals.cspNonce = process.env.NODE_ENV === 'production' && isHtmlRequest ? randomUUID().replace(/-/g, '') : null;
  next();
});
app.use(
  helmet({
    crossOriginEmbedderPolicy: process.env.NODE_ENV === 'production',
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts:
      process.env.NODE_ENV === 'production'
        ? {
            maxAge: 15552000,
            includeSubDomains: true,
            preload: true
          }
        : false,
    contentSecurityPolicy:
      process.env.NODE_ENV === 'production'
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: [
                "'self'",
                (_req, res) => (res.locals.cspNonce ? `'nonce-${res.locals.cspNonce}'` : "'self'"),
                'https://accounts.google.com',
                'https://appleid.cdn-apple.com',
                'https://connect.facebook.net'
              ],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              connectSrc: ["'self'", 'https://accounts.google.com', 'https://appleid.apple.com', 'https://graph.facebook.com', 'https://www.facebook.com'],
              frameSrc: ["'self'", 'https://accounts.google.com', 'https://www.facebook.com'],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              frameAncestors: ["'none'"]
            }
          }
        : false
  })
);
app.disable('x-powered-by');

// Raw body capture for Stripe webhook signature verification
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, _res, next) => {
  if (Buffer.isBuffer(req.body)) req.rawBody = req.body.toString('utf8');
  next();
});

app.use(
  express.json({
    limit: JSON_BODY_LIMIT,
    strict: true,
    type: ['application/json', 'application/*+json']
  })
);

function sendMachineError(req, res, status, error, extra = {}) {
  const payload = buildErrorPayload(req, {
    status,
    error,
    message: extra.message,
    resetAt: extra.reset_at || extra.resetAt || null
  });
  const passthrough = {};
  for (const [key, value] of Object.entries(extra || {})) {
    if (
      value === undefined ||
      key === 'message' ||
      key === 'reset_at' ||
      key === 'resetAt' ||
      key === 'error' ||
      key === 'status' ||
      key === 'request_id'
    ) {
      continue;
    }
    passthrough[key] = value;
  }
  return res.status(status).json({ ...payload, ...passthrough });
}

function rejectHardenedPayload(req, res, reason) {
  if (reason === 'payload_too_large') return sendMachineError(req, res, 413, 'payload_too_large');
  return sendMachineError(req, res, 400, 'invalid_payload');
}

const genericApiPayloadGuard = createPayloadHardeningMiddleware({
  maxBytes: API_MAX_BODY_BYTES,
  maxDepth: PAYLOAD_MAX_DEPTH,
  maxNodes: PAYLOAD_MAX_NODES,
  maxArrayLength: PAYLOAD_MAX_ARRAY_LENGTH,
  maxObjectKeys: PAYLOAD_MAX_OBJECT_KEYS,
  maxStringLength: PAYLOAD_MAX_STRING_LENGTH,
  maxKeyLength: PAYLOAD_MAX_KEY_LENGTH,
  rejectControlCharacters: true,
  onReject: rejectHardenedPayload
});

const authPayloadGuard = createPayloadHardeningMiddleware({
  maxBytes: AUTH_MAX_BODY_BYTES,
  maxDepth: Math.min(PAYLOAD_MAX_DEPTH, 8),
  maxNodes: Math.min(PAYLOAD_MAX_NODES, 500),
  maxArrayLength: Math.min(PAYLOAD_MAX_ARRAY_LENGTH, 50),
  maxObjectKeys: Math.min(PAYLOAD_MAX_OBJECT_KEYS, 60),
  maxStringLength: Math.min(PAYLOAD_MAX_STRING_LENGTH, 2048),
  maxKeyLength: PAYLOAD_MAX_KEY_LENGTH,
  rejectControlCharacters: true,
  onReject: rejectHardenedPayload
});

const outboundPayloadGuard = createPayloadHardeningMiddleware({
  maxBytes: OUTBOUND_MAX_BODY_BYTES,
  maxDepth: Math.min(PAYLOAD_MAX_DEPTH, 8),
  maxNodes: Math.min(PAYLOAD_MAX_NODES, 600),
  maxArrayLength: Math.min(PAYLOAD_MAX_ARRAY_LENGTH, 80),
  maxObjectKeys: Math.min(PAYLOAD_MAX_OBJECT_KEYS, 80),
  maxStringLength: Math.min(PAYLOAD_MAX_STRING_LENGTH, 4096),
  maxKeyLength: PAYLOAD_MAX_KEY_LENGTH,
  rejectControlCharacters: true,
  onReject: rejectHardenedPayload
});

app.use('/api', genericApiPayloadGuard);
app.use('/api/auth', authPayloadGuard);
app.use('/api/outbound', outboundPayloadGuard);
app.use(
  '/api/admin/telemetry',
  createPayloadHardeningMiddleware({
    maxBytes: ADMIN_TELEMETRY_MAX_BODY_BYTES,
    maxDepth: 6,
    maxNodes: 200,
    maxArrayLength: 20,
    maxObjectKeys: 50,
    maxStringLength: 512,
    maxKeyLength: 64,
    rejectControlCharacters: true,
    onReject: rejectHardenedPayload
  })
);

function rateLimitKey(req) {
  if (req.user?.sub || req.user?.id) return `user:${req.user.sub || req.user.id}`;
  if (req.apiKeyId) return `api_key:${req.apiKeyId}`;
  const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
  if (ip) return `ip:${ip}`;
  return 'anonymous';
}

function createDistributedLimiter({ namespace, windowMs, limit }) {
  const cache = getCacheClient();
  const safeWindowMs = Math.max(1000, Number(windowMs) || 60_000);
  const safeLimit = Math.max(1, Number(limit) || 60);
  const ttlSec = Math.max(2, Math.ceil(safeWindowMs / 1000) + 2);
  return async (req, res, next) => {
    const now = Date.now();
    const bucket = Math.floor(now / safeWindowMs);
    const key = `${namespace}:${bucket}:${rateLimitKey(req)}`;
    try {
      const used = Number(await cache.incr(key));
      if (Number.isFinite(used) && used === 1 && typeof cache.expire === 'function') {
        await cache.expire(key, ttlSec);
      }
      const resetTs = (bucket + 1) * safeWindowMs;
      const resetTime = new Date(resetTs);
      const remaining = Math.max(0, safeLimit - used);
      req.rateLimit = {
        limit: safeLimit,
        used,
        remaining,
        resetTime
      };
      res.setHeader('X-RateLimit-Limit', String(safeLimit));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      if (used > safeLimit) {
        return sendMachineError(req, res, 429, 'limit_exceeded', { reset_at: resetTime.toISOString() });
      }
      return next();
    } catch (error) {
      logger.warn({ err: error, namespace }, 'distributed_rate_limit_failed_open');
      return next();
    }
  };
}

function toIsoFromRateLimit(req) {
  const resetTime = req.rateLimit?.resetTime;
  if (resetTime instanceof Date) return resetTime.toISOString();
  const fallback = new Date(Date.now() + 60 * 1000);
  return fallback.toISOString();
}

const useDistributedRateLimiting = Boolean(String(process.env.REDIS_URL || '').trim());

const standardApiLimiter = useDistributedRateLimiting
  ? createDistributedLimiter({
      namespace: 'rl:api',
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: RATE_LIMIT_MAX
    })
  : rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => sendMachineError(req, res, 429, 'limit_exceeded', { reset_at: toIsoFromRateLimit(req) })
});

const strictAuthPathLimiter = useDistributedRateLimiting
  ? createDistributedLimiter({
      namespace: 'rl:auth',
      windowMs: 60 * 1000,
      limit: RL_AUTH_PER_MINUTE
    })
  : rateLimit({
  windowMs: 60 * 1000,
  limit: RL_AUTH_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => sendMachineError(req, res, 429, 'limit_exceeded', { reset_at: toIsoFromRateLimit(req) })
});

const moderateDemoLimiter = useDistributedRateLimiting
  ? createDistributedLimiter({
      namespace: 'rl:demo',
      windowMs: 60 * 1000,
      limit: Number(process.env.RL_DEMO_PER_MINUTE || 40)
    })
  : rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RL_DEMO_PER_MINUTE || 40),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => sendMachineError(req, res, 429, 'limit_exceeded', { reset_at: toIsoFromRateLimit(req) })
});

app.use('/api', (req, res, next) => {
  const origin = String(req.headers.origin || '').trim();
  if (origin && !CORS_ALLOWLIST.has(origin)) {
    return sendMachineError(req, res, 403, 'request_forbidden');
  }

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CSRF-Token, X-Request-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  }

  if (req.method === 'OPTIONS') return res.status(204).send();
  return next();
});
app.use('/auth', strictAuthPathLimiter);
app.use('/demo', moderateDemoLimiter);
app.use('/api/auth', strictAuthPathLimiter);
app.use('/api/auth', (req, res, next) => {
  if (!AUTH_REQUIRE_TRUSTED_ORIGIN) return next();
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'OPTIONS') return next();
  const path = String(req.path || '').trim().toLowerCase();
  if (path.startsWith('/oauth/')) return next();
  if (!isTrustedOrigin(req)) return sendMachineError(req, res, 403, 'request_forbidden');
  return next();
});
app.use('/api/auth', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
const outboundBurstLimiter = useDistributedRateLimiting
  ? createDistributedLimiter({
      namespace: 'rl:outbound:burst',
      windowMs: 1000,
      limit: RL_OUTBOUND_PER_SECOND
    })
  : rateLimit({
  windowMs: 1000,
  limit: RL_OUTBOUND_PER_SECOND,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => sendMachineError(req, res, 429, 'rate_limited', { reset_at: toIsoFromRateLimit(req) })
});
const outboundPathLimiter = useDistributedRateLimiting
  ? createDistributedLimiter({
      namespace: 'rl:outbound',
      windowMs: 60 * 1000,
      limit: RL_OUTBOUND_PER_MINUTE
    })
  : rateLimit({
  windowMs: 60 * 1000,
  limit: RL_OUTBOUND_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => sendMachineError(req, res, 429, 'rate_limited', { reset_at: toIsoFromRateLimit(req) })
});
app.use('/api/outbound', outboundBurstLimiter, outboundPathLimiter);
app.use('/api', standardApiLimiter);
app.use('/api', apiKeyAuth);
app.use(
  '/',
  buildFreeFoundationRouter({
    corsAllowlist: Array.from(CORS_ALLOWLIST),
    legacyAuthEnabled: LEGACY_AUTH_ROUTES_ENABLED,
    registrationEnabled: REGISTRATION_ENABLED
  })
);
const authLimiter = useDistributedRateLimiting
  ? createDistributedLimiter({
      namespace: 'rl:auth:login',
      windowMs: 15 * 60 * 1000,
      limit: Number(process.env.RL_LOGIN_ATTEMPTS_15M || 12)
    })
  : rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RL_LOGIN_ATTEMPTS_15M || 12),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => sendMachineError(req, res, 429, 'limit_exceeded', { reset_at: toIsoFromRateLimit(req) })
});

const telemetryEventLimiter = useDistributedRateLimiting
  ? createDistributedLimiter({
      namespace: 'rl:telemetry',
      windowMs: 60 * 1000,
      limit: Number(process.env.RL_TELEMETRY_PER_MINUTE || 80)
    })
  : rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RL_TELEMETRY_PER_MINUTE || 80),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => sendMachineError(req, res, 429, 'limit_exceeded', { reset_at: toIsoFromRateLimit(req) })
});
const telemetryBurstLimiter = useDistributedRateLimiting
  ? createDistributedLimiter({
      namespace: 'rl:telemetry:burst',
      windowMs: 1000,
      limit: RL_TELEMETRY_PER_SECOND
    })
  : rateLimit({
  windowMs: 1000,
  limit: RL_TELEMETRY_PER_SECOND,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => sendMachineError(req, res, 429, 'rate_limited', { reset_at: toIsoFromRateLimit(req) })
});

const appContext = createRuntimeAppContext({
  env: process.env,
  logger,
  scanProviderOverlapPolicy: SCAN_PROVIDER_OVERLAP_POLICY,
  flightScanEnabled: FLIGHT_SCAN_ENABLED,
  providerCollectionEnabled: PROVIDER_COLLECTION_ENABLED,
  createFlightProviderRegistry,
  createProviderRegistry,
  createLiveFlightService,
  createScanStatusService,
  buildBookingLink,
  outboundAllowedHostsEnv: process.env.OUTBOUND_ALLOWED_HOSTS,
  evaluateStartupReadiness,
  getCacheClient
});
const {
  flightProviderRegistry,
  dataProviderRegistry,
  liveFlightService,
  scanStatusService,
  providerCollectionEffectiveEnabled: providerCollectionEffectiveEnabledFromContext,
  startupReadiness,
  runtimeConfigAudit
} = appContext;

await verifyPrimaryInfrastructureOrFail({
  env: process.env,
  logger,
  pgPool,
  getCacheClient,
  requirePrimaryInfraInProduction: REQUIRE_PRIMARY_INFRA_IN_PRODUCTION,
  primaryInfraCheckTimeoutMs: PRIMARY_INFRA_CHECK_TIMEOUT_MS,
  insecureStartupBypassEnabled: INSECURE_STARTUP_BYPASS_ENABLED,
  allowInsecureStartupForTests: ALLOW_INSECURE_STARTUP_FOR_TESTS,
  allowInsecureStartupInProduction: ALLOW_INSECURE_STARTUP_IN_PRODUCTION,
  failFast: (code) => process.exit(code)
});
enforceStartupReadinessOrFail({
  env: process.env,
  logger,
  startupReadiness,
  runtimeConfigAudit,
  insecureStartupBypassEnabled: INSECURE_STARTUP_BYPASS_ENABLED,
  allowInsecureStartupForTests: ALLOW_INSECURE_STARTUP_FOR_TESTS,
  allowInsecureStartupInProduction: ALLOW_INSECURE_STARTUP_IN_PRODUCTION,
  failFast: (code) => process.exit(code)
});

logStartupCapabilityWarnings({ env: process.env, logger });
const COUNTRIES = worldCountries
  .map((country) => ({
    name: country?.name?.common || '',
    officialName: country?.name?.official || '',
    cca2: country?.cca2 || '',
    region: country?.region || '',
    subregion: country?.subregion || ''
  }))
  .filter((country) => country.name)
  .sort((a, b) => a.name.localeCompare(b.name));

const {
  adminGuard,
  authCookieOptions,
  authGuard,
  buildEmailVerifyUrl,
  buildPasswordResetUrl,
  buildSessionResponsePayload,
  clearOAuthBrowserBinding,
  completeOAuthLogin,
  consumeOAuthSessionById,
  consumeOAuthSessionByState,
  createOAuthSession,
  csrfGuard,
  ensureAiPremiumAccess,
  ensureOAuthBrowserBinding,
  fetchCurrentUser,
  getRefreshTokenFromCookie,
  hashEmailVerifyToken,
  hashPasswordResetToken,
  isTrustedOrigin,
  issueSessionTokens,
  logAuthEvent,
  optionalAuth,
  premiumGuard,
  refreshCsrfGuard,
  registerFailedLogin,
  requireSessionAuth,
  resetUserLoginFailures,
  resolveOAuthBindingHash,
  revokeJwt,
  revokeRefreshFamily,
  rotateRefreshSession,
  userIsLocked
} = createAuthRuntime({
  constants: {
    ACCESS_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    OAUTH_BINDING_COOKIE_NAME,
    ACCESS_COOKIE_TTL_MS,
    REFRESH_COOKIE_TTL_MS,
    AUTH_COOKIE_DOMAIN,
    AUTH_RETURN_ACCESS_TOKEN,
    NODE_ENV,
    OAUTH_SESSION_TTL_SECONDS,
    FRONTEND_URL,
    LOGIN_MAX_FAILURES,
    LOGIN_LOCK_MINUTES,
    CORS_ALLOWLIST,
    ADMIN_ALLOWLIST_EMAILS,
    ADMIN_DASHBOARD_ENABLED
  },
  deps: {
    withDb,
    readDb,
    nanoid,
    randomBytes,
    createHash,
    getCookies,
    readAccessTokenFromCookie,
    readRefreshTokenFromCookie,
    resolveRequestAuthToken,
    verifyAccessToken,
    verifyRefreshToken,
    signAccessToken,
    signRefreshToken,
    appendImmutableAudit,
    hashValueForLogs,
    anonymizeIpForLogs,
    redactUrlForLogs,
    logger,
    sendMachineError,
    upsertUserLead,
    getOrCreateSubscription,
    resolveUserPlan,
    canUseAITravel,
    getUpgradeContext
  }
});

const runFeatureAudit = () =>
  runFeatureAuditModule({
    searchFlights,
    connectionTypes: CONNECTION_ENUM,
    travelTimes: TRAVEL_TIME_ENUM,
    loginMaxFailures: LOGIN_MAX_FAILURES,
    loginLockMinutes: LOGIN_LOCK_MINUTES
  });

const { monitorAndUpdateSubscriptionPricing, scanSubscriptionsOnce, scanPriceAlertsOnce, enrichDecisionWithAi, parseIntentWithAi } = createDomainServices({
  withDb,
  appendImmutableAudit,
  nanoid,
  env: process.env,
  fetchImpl: fetch,
  searchFlights,
  sendMail,
  insertEmailDeliveryLog,
  getCacheClient,
  logger,
  subscriptionScanCacheTtlSec: SUBSCRIPTION_SCAN_CACHE_TTL_SEC,
  subscriptionScanLockTtlSec: SUBSCRIPTION_SCAN_LOCK_TTL_SEC,
  runPriceAlertsWorkerOnce,
  priceAlertsWorkerLimit: PRICE_ALERTS_WORKER_LIMIT
});

app.use(
  buildSystemRouter({
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
    providerRegistry: dataProviderRegistry,
    getScanProviderAdapterMetrics,
    getDiscoveryFeedRuntimeMetrics,
    getLiveFlightCacheMetrics: () => liveFlightService.getCacheMetrics?.() || {},
    getAiCacheMetrics,
    getAiCostGuardMetrics,
    getProviderCostGuardMetrics,
    getRuntimeConfigAudit,
    evaluateStartupReadiness,
    authGuard,
    requireSessionAuth,
    adminGuard,
    csrfGuard,
    requireApiScope,
    quotaGuard,
    FLIGHT_SCAN_ENABLED,
    getFlightScanStatus: () =>
      scanStatusService.getStatus({
        recentRunsLimit: Math.max(1, Math.min(100, Number(process.env.FLIGHT_SCAN_STATUS_RECENT_RUNS || 20)))
      }),
    runFlightScanSchedulerOnce,
    runFlightScanWorkerOnce,
    runFlightScanCycleOnce
  })
);
app.get('/api/security/audit/verify', authGuard, requireSessionAuth, adminGuard, async (_req, res) => {
  const result = await verifyImmutableAudit();
  return res.json(result);
});

app.get('/api/monetization/report', authGuard, requireSessionAuth, adminGuard, async (_req, res) => {
  const sql = await getBusinessMetrics();
  let outbound = { searchCount: 0, outboundClicks: 0, clickThroughRatePct: 0 };
  await withDb(async (db) => {
    const report = buildOutboundReport(db, 30);
    outbound = report.summary;
    return null;
  });
  return res.json({
    generatedAt: new Date().toISOString(),
    sql,
    outbound
  });
});

app.get('/api/billing/pricing', async (_req, res, next) => {
  try {
    const pricing = await getPricingConfig();
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    return res.json(pricing);
  } catch (err) {
    next(err);
  }
});

app.get('/api/analytics/funnel', authGuard, requireSessionAuth, adminGuard, async (_req, res) => {
  const sqlFunnel = await getFunnelMetricsByChannel();
  return res.json({
    generatedAt: new Date().toISOString(),
    channels: sqlFunnel.items || []
  });
});

app.use(
  buildAdminTelemetryRouter({
    telemetryBurstLimiter,
    telemetryEventLimiter,
    authGuard,
    requireSessionAuth,
    csrfGuard,
    safeJsonByteLength,
    sendMachineError,
    adminTelemetryEventSchema,
    withDb,
    fetchCurrentUser,
    resolveUserPlan,
    logger,
    createHash,
    ADMIN_TELEMETRY_MAX_BODY_BYTES,
    ADMIN_TELEMETRY_ALLOWED_SKEW_MS,
    ADMIN_TELEMETRY_DEDUPE_WINDOW_MS,
    TELEMETRY_BURST_WINDOW_MS,
    TELEMETRY_BURST_MAX,
    toIsoFromRateLimit
  })
);

app.get('/api/admin/backoffice/report', authGuard, requireSessionAuth, adminGuard, async (_req, res) => {
  let report = null;
  const followSignals = await getFollowSignalsSummary({ limit: 10 }).catch(() => ({ total: 0, topRoutes: [] }));
  const costMonitoring = await getCostCapMonitoringSnapshot().catch(() => null);
  await withDb(async (db) => {
    report = buildAdminBackofficeReport({ db, followSignals, now: Date.now(), windowDays: 30, costMonitoring });
    return null;
  });
  return res.json(report);
});

app.use(
  '/api',
  buildSearchRouter({
    ORIGINS,
    REGION_ENUM,
    CABIN_ENUM,
    CONNECTION_ENUM,
    TRAVEL_TIME_ENUM,
    DESTINATIONS,
    COUNTRIES,
    getDestinationSuggestions,
    searchFlights,
    decideTrips,
    ensureAiPremiumAccess,
    enrichDecisionWithAi,
    parseIntentWithAi,
    searchSchema,
    justGoSchema,
    decisionIntakeSchema,
    authGuard,
    csrfGuard,
    requireApiScope,
    quotaGuard,
    withDb,
    insertSearchEvent,
    getOrCreateSubscription,
    nanoid,
    sendMachineError,
    captureUserPriceObservation,
    searchProviderOffers: (params) => dataProviderRegistry.searchOffers(params),
    cacheClient: getCacheClient(),
    liveFlightService
  })
);
app.use(
  '/api',
  buildAuthLocalRouter({
    authLimiter,
    registrationEnabled: REGISTRATION_ENABLED,
    registerSchema,
    loginSchema,
    loginMfaVerifySchema,
    passwordResetRequestSchema,
    passwordResetConfirmSchema,
    emailVerifySchema,
    sendMachineError,
    withDb,
    readDb,
    hashPassword,
    verifyPassword,
    logAuthEvent,
    upsertUserLead,
    issueSessionTokens,
    buildSessionResponsePayload,
    resolveUserPlan,
    userIsLocked,
    registerFailedLogin,
    resetUserLoginFailures,
    hashPasswordResetToken,
    buildPasswordResetUrl,
    hashEmailVerifyToken,
    buildEmailVerifyUrl,
    sendMail,
    nanoid,
    randomBytes,
    addDays,
    logger,
    speakeasy,
    loginDummyPasswordHash: LOGIN_DUMMY_PASSWORD_HASH,
    grantPremiumTrial,
    checkAndExpireTrial
  })
);
app.use(
  buildAuthOAuthRouter({
    authLimiter,
    frontendUrl: FRONTEND_URL,
    googleOAuthRedirectUri: GOOGLE_OAUTH_REDIRECT_URI,
    appleOAuthRedirectUri: APPLE_OAUTH_REDIRECT_URI,
    facebookOAuthRedirectUri: FACEBOOK_OAUTH_REDIRECT_URI,
    ensureOAuthBrowserBinding,
    createOAuthSession,
    clearOAuthBrowserBinding,
    resolveOAuthBindingHash,
    consumeOAuthSessionByState,
    consumeOAuthSessionById,
    exchangeGoogleCodeForTokens,
    exchangeAppleCodeForTokens,
    exchangeFacebookCodeForProfile,
    verifyGoogleIdToken,
    verifyAppleIdToken,
    completeOAuthLogin
  })
);
app.use(
  '/api',
  buildAuthSessionRouter({
    authGuard,
    requireSessionAuth,
    csrfGuard,
    withDb,
    readDb,
    logAuthEvent,
    userIsLocked,
    onboardingCompleteSchema,
    revokeJwt,
    getRefreshTokenFromCookie,
    verifyRefreshToken,
    revokeRefreshFamily,
    ACCESS_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    authCookieOptions,
    ACCESS_COOKIE_TTL_MS,
    REFRESH_COOKIE_TTL_MS,
    AUTH_COOKIE_DOMAIN,
    sendMachineError,
    refreshCsrfGuard,
    logger,
    rotateRefreshSession,
    signRefreshToken,
    signAccessToken,
    speakeasy,
    QRCode,
    mfaCodeSchema,
    includeAccessTokenInResponse: AUTH_RETURN_ACCESS_TOKEN
  })
);
app.use(
  buildOutboundRouter({
    authGuard,
    requireSessionAuth,
    adminGuard,
    requireApiScope,
    quotaGuard,
    optionalAuth,
    withDb,
    sendMachineError,
    resolveOutboundPartnerUrl: (payload) => flightProviderRegistry.resolveOutboundPartnerUrl(payload),
    ensureAllowedOutboundUrl: (rawUrl) => flightProviderRegistry.ensureAllowedUrl(rawUrl),
    allowedPartners: flightProviderRegistry.allowedPartners,
    outboundClickSecret: OUTBOUND_CLICK_SECRET,
    outboundClickTtlSeconds: OUTBOUND_CLICK_TTL_SECONDS,
    outboundMaxQueryChars: OUTBOUND_MAX_QUERY_CHARS
  })
);

app.use(
  buildPublicUtilityRouter({
    buildAllAffiliateLinks,
    authGuard,
    csrfGuard,
    premiumGuard,
    requireApiScope,
    quotaGuard,
    destinationInsightSchema,
    buildDestinationInsights,
    searchFlights
  })
);

app.use(
  '/api',
  buildAlertsRouter({
    authGuard,
    csrfGuard,
    requireApiScope,
    quotaGuard,
    withDb,
    nanoid,
    scanSubscriptionsOnce,
    scanPriceAlertsOnce,
    watchlistSchema,
    alertSubscriptionSchema,
    alertSubscriptionUpdateSchema,
    fetchCurrentUser,
    sendMachineError
  })
);
// ── SaaS routes ───────────────────────────────────────────────────
// Mount routers (they receive authGuard/csrfGuard from closure)
app.use('/api/push',    buildPushRouter({ authGuard, csrfGuard }));
app.use('/api/keys',    buildApiKeysRouter({ authGuard, csrfGuard }));
app.use('/api/billing', buildBillingRouter({ authGuard, requireSessionAuth, csrfGuard }));
app.use('/api/usage',   buildUsageRouter({ authGuard }));
app.use('/api',         buildUserExportRouter({ authGuard, requireSessionAuth, quotaGuard, withDb, readDb, fetchCurrentUser }));
app.use('/', buildDealEngineRouter({ authGuard }));
app.use('/api/discovery', buildDiscoveryRouter({ authGuard, csrfGuard, quotaGuard, requireApiScope }));
app.use('/api/opportunities', buildOpportunitiesRouter({ authGuard, requireSessionAuth, adminGuard, csrfGuard, requireApiScope, quotaGuard, withDb, optionalAuth }));

app.use(errorHandler);

// Legal pages — served before the SPA catch-all
app.get('/privacy-policy', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.status(200).send(renderPrivacyPolicy());
});
app.get('/cookie-policy', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.status(200).send(renderCookiePolicy());
});
app.get('/terms', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.status(200).send(renderTermsOfService());
});

const distPath = resolve(process.cwd(), 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*any}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const indexPath = resolve(distPath, 'index.html');
    let html = readFileSync(indexPath, 'utf8');
    if (process.env.NODE_ENV === 'production') {
      const nonce = res.locals.cspNonce;
      html = html.replace(/<script(?![^>]*nonce=)/g, `<script nonce="${nonce}"`);
    }
    return res.status(200).send(html);
  });
}

startRuntimeLifecycle({
  app,
  port: PORT,
  buildVersion: BUILD_VERSION,
  runtimeMode: RUNTIME_MODE,
  logger,
  pgPool,
  closeCacheClient,
  shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
  cronRetryAttempts: CRON_RETRY_ATTEMPTS,
  cronRetryDelayMs: CRON_RETRY_DELAY_MS,
  cronAllowOverlapJobsCsv: process.env.CRON_ALLOW_OVERLAP_JOBS,
  runStartupTasks: RUN_STARTUP_TASKS,
  bootstrapSeedImportFile: BOOTSTRAP_SEED_IMPORT_FILE,
  bootstrapSeedImportDryRun: BOOTSTRAP_SEED_IMPORT_DRY_RUN,
  schedules: {
    cronSchedule: CRON_SCHEDULE,
    aiPricingCron: AI_PRICING_CRON,
    aiPricingTimezone: AI_PRICING_CRON_TIMEZONE,
    freePrecomputeCron: FREE_PRECOMPUTE_CRON,
    freeAlertWorkerCron: FREE_ALERT_WORKER_CRON,
    freeJobsTimezone: FREE_JOBS_TIMEZONE,
    dealBaselineCron: DEAL_BASELINE_CRON,
    dealBaselineTimezone: DEAL_BASELINE_CRON_TIMEZONE,
    discoveryAlertWorkerCron: DISCOVERY_ALERT_WORKER_CRON,
    discoveryAlertWorkerTimezone: DISCOVERY_ALERT_WORKER_TIMEZONE,
    priceIngestWorkerCron: PRICE_INGEST_WORKER_CRON,
    priceIngestWorkerTimezone: PRICE_INGEST_WORKER_TIMEZONE,
    opportunityPipelineCron: OPPORTUNITY_PIPELINE_CRON,
    opportunityPipelineTimezone: OPPORTUNITY_PIPELINE_TIMEZONE,
    ingestionJobsMaintenanceCron: INGESTION_JOBS_MAINTENANCE_CRON,
    ingestionJobsMaintenanceTimezone: INGESTION_JOBS_MAINTENANCE_TIMEZONE,
    routePriceStatsCron: ROUTE_PRICE_STATS_CRON,
    routePriceStatsTimezone: ROUTE_PRICE_STATS_TIMEZONE,
    detectedDealsCron: DETECTED_DEALS_CRON,
    detectedDealsTimezone: DETECTED_DEALS_TIMEZONE,
    dealsContentCron: DEALS_CONTENT_CRON,
    dealsContentTimezone: DEALS_CONTENT_TIMEZONE,
    priceAlertsCron: PRICE_ALERTS_CRON,
    priceAlertsTimezone: PRICE_ALERTS_TIMEZONE,
    radarMatchPrecomputeCron: RADAR_MATCH_PRECOMPUTE_CRON,
    radarMatchPrecomputeTimezone: RADAR_MATCH_PRECOMPUTE_TIMEZONE,
    flightScanSchedulerCron: FLIGHT_SCAN_SCHEDULER_CRON,
    flightScanWorkerCron: FLIGHT_SCAN_WORKER_CRON,
    flightScanTimezone: FLIGHT_SCAN_TIMEZONE,
    providerCollectionCron: PROVIDER_COLLECTION_CRON,
    providerCollectionTimezone: PROVIDER_COLLECTION_TIMEZONE
  },
  flags: {
    routePriceStatsEnabled: ROUTE_PRICE_STATS_ENABLED,
    detectedDealsEnabled: DETECTED_DEALS_ENABLED,
    dealsContentEnabled: DEALS_CONTENT_ENABLED,
    dealsContentRunOnStartup: DEALS_CONTENT_RUN_ON_STARTUP,
    priceAlertsEnabled: PRICE_ALERTS_ENABLED,
    flightScanEnabled: FLIGHT_SCAN_ENABLED,
    providerCollectionEffectiveEnabled: providerCollectionEffectiveEnabledFromContext
  },
  limits: {
    priceAlertsWorkerLimit: PRICE_ALERTS_WORKER_LIMIT
  },
  jobs: {
    scanSubscriptionsOnce,
    monitorAndUpdateSubscriptionPricing,
    runNightlyFreePrecompute,
    runFreeAlertWorkerOnce,
    runNightlyRouteBaselineJob,
    runBaselineRecomputeOnce,
    runDiscoveryAlertWorkerOnce,
    runPriceIngestionWorkerOnce,
    runOpportunityPipelineOnce,
    runIngestionJobsMaintenance,
    runRoutePriceStatsWorkerOnce,
    runDetectedDealsWorkerOnce,
    runDealsContentWorkerOnce,
    runPriceAlertsWorkerOnce,
    runRadarMatchPrecomputeOnce,
    runFlightScanSchedulerOnce,
    runFlightScanWorkerOnce,
    runProviderCollectionOnce,
    runSeedImportOnce
  },
  getDataFoundationStatus
});







