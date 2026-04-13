import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import { nanoid } from 'nanoid';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { addDays, format, parseISO } from 'date-fns';
import worldCountries from 'world-countries';
import { z } from 'zod';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { hashPassword, signAccessToken, signRefreshToken, verifyAccessToken, verifyPassword, verifyRefreshToken } from './lib/auth.js';
import { buildBookingLink, decideTrips, getDestinationSuggestions, searchFlights } from './lib/flight-engine.js';
import { readDb, withDb } from './lib/db.js';
import { appendImmutableAudit, verifyImmutableAudit } from './lib/audit-log.js';
import { getBusinessMetrics, getFunnelMetricsByChannel, initSqlDb, insertEmailDeliveryLog, insertSearchEvent, upsertUserLead } from './lib/sql-db.js';
import { sendMail } from './lib/mailer.js';
import { exchangeAppleCodeForTokens, exchangeFacebookCodeForProfile, exchangeGoogleCodeForTokens, verifyAppleIdToken, verifyGoogleIdToken } from './lib/oauth.js';
import { DESTINATIONS, ORIGINS } from './data/flights-data.js';
import pg from 'pg';
import { getOrCreateSubscription, getPricingConfig, PLANS, setSaasPool } from './lib/saas-db.js';
import { quotaGuard, apiKeyAuth, requireApiScope } from './middleware/quotaGuard.js';
import { buildApiKeysRouter } from './routes/apikeys.js';
import { buildBillingRouter } from './routes/billing.js';
import { buildUsageRouter } from './routes/usage.js';
import { buildFreeFoundationRouter } from './routes/free-foundation.js';
import { buildDealEngineRouter } from './routes/deal-engine.js';
import { buildDiscoveryRouter } from './routes/discovery.js';
import { buildOpportunitiesRouter } from './routes/opportunities.js';
import { buildAlertsRouter } from './routes/alerts.js';
import { buildSystemRouter } from './routes/system.js';
import { buildSearchRouter } from './routes/search.js';
import { buildAuthSessionRouter } from './routes/auth-session.js';
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
import { closeCacheClient, getCacheClient } from './lib/free-cache.js';
import { createFlightProviderRegistry } from './lib/flight-provider.js';
import { createProviderRegistry } from './lib/providers/provider-registry.js';
import { getScanProviderAdapterMetrics } from './lib/scan/provider-adapter.js';
import { createScanStatusService } from './lib/scan/scan-status-service.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { buildErrorPayload, errorHandler, getErrorCode, getHumanErrorMessage } from './middleware/error-handler.js';
import { logger, requestLogger } from './lib/logger.js';
import { getDataFoundationStatus, runIngestionJobsMaintenance } from './lib/deal-engine-store.js';
import { getOpportunityIntelligenceDebugStats, getOpportunityPipelineStats } from './lib/opportunity-store.js';
import { getDiscoveryFeedRuntimeMetrics } from './lib/discovery-feed-service.js';
import { getRuntimeConfigAudit } from './lib/runtime-config.js';
import { evaluateStartupReadiness } from './lib/startup-readiness.js';
import { canUseAITravel, canUseRadar, resolveUserPlan } from './lib/plan-access.js';
import { createNotificationScanService } from './lib/notification-scan-service.js';
import { buildOutboundReport, outboundReportToCsv } from './lib/outbound-report.js';
import { createAuditCheck, runFeatureAudit as runFeatureAuditModule } from './lib/feature-audit.js';

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
const PORT = Number(process.env.PORT || 3000);
const CRON_SCHEDULE = process.env.NOTIFICATION_CRON || '*/10 * * * *';
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;
const OAUTH_SESSION_TTL_SECONDS = Number(process.env.OAUTH_SESSION_TTL_SECONDS || 300);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/oauth/google/callback';
const APPLE_OAUTH_REDIRECT_URI = process.env.APPLE_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/oauth/apple/callback';
const FACEBOOK_OAUTH_REDIRECT_URI = process.env.FACEBOOK_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/oauth/facebook/callback';
const AI_PRICING_CRON = process.env.AI_PRICING_CRON || '0 0,8 * * *';
const AI_PRICING_CRON_TIMEZONE = process.env.AI_PRICING_CRON_TIMEZONE || 'Europe/Rome';
const AI_TARGET_MARGIN = Number(process.env.AI_TARGET_MARGIN || 0.72);
const AI_USAGE_GROWTH_FACTOR = Number(process.env.AI_USAGE_GROWTH_FACTOR || 1.15);
const AI_PLATFORM_OVERHEAD_EUR = Number(process.env.AI_PLATFORM_OVERHEAD_EUR || 2.2);
const AI_SAFETY_BUFFER_EUR = Number(process.env.AI_SAFETY_BUFFER_EUR || 1.4);
const AI_COST_FEED_URL = String(process.env.AI_COST_FEED_URL || '').trim();
const FREE_PRECOMPUTE_CRON = process.env.FREE_PRECOMPUTE_CRON || '20 2 * * *';
const FREE_ALERT_WORKER_CRON = process.env.FREE_ALERT_WORKER_CRON || '*/15 * * * *';
const FREE_JOBS_TIMEZONE = process.env.FREE_JOBS_TIMEZONE || 'UTC';
const DEAL_BASELINE_CRON = process.env.DEAL_BASELINE_CRON || '10 1 * * *';
const DEAL_BASELINE_CRON_TIMEZONE = process.env.DEAL_BASELINE_CRON_TIMEZONE || FREE_JOBS_TIMEZONE;
const DISCOVERY_ALERT_WORKER_CRON = process.env.DISCOVERY_ALERT_WORKER_CRON || '*/20 * * * *';
const DISCOVERY_ALERT_WORKER_TIMEZONE = process.env.DISCOVERY_ALERT_WORKER_TIMEZONE || FREE_JOBS_TIMEZONE;
const PRICE_INGEST_WORKER_CRON = process.env.PRICE_INGEST_WORKER_CRON || '*/5 * * * *';
const PRICE_INGEST_WORKER_TIMEZONE = process.env.PRICE_INGEST_WORKER_TIMEZONE || FREE_JOBS_TIMEZONE;
const PROVIDER_COLLECTION_ENABLED = String(process.env.PROVIDER_COLLECTION_ENABLED || 'false').trim().toLowerCase() === 'true';
const SCAN_PROVIDER_OVERLAP_POLICY = String(process.env.SCAN_PROVIDER_OVERLAP_POLICY || 'mutual_exclusive').trim().toLowerCase();
const PROVIDER_COLLECTION_CRON = process.env.PROVIDER_COLLECTION_CRON || '17 * * * *';
const PROVIDER_COLLECTION_TIMEZONE = process.env.PROVIDER_COLLECTION_TIMEZONE || FREE_JOBS_TIMEZONE;
const OPPORTUNITY_PIPELINE_CRON = process.env.OPPORTUNITY_PIPELINE_CRON || '*/30 * * * *';
const OPPORTUNITY_PIPELINE_TIMEZONE = process.env.OPPORTUNITY_PIPELINE_TIMEZONE || FREE_JOBS_TIMEZONE;
const INGESTION_JOBS_MAINTENANCE_CRON = process.env.INGESTION_JOBS_MAINTENANCE_CRON || '*/15 * * * *';
const INGESTION_JOBS_MAINTENANCE_TIMEZONE = process.env.INGESTION_JOBS_MAINTENANCE_TIMEZONE || FREE_JOBS_TIMEZONE;
const ROUTE_PRICE_STATS_ENABLED = String(process.env.ROUTE_PRICE_STATS_ENABLED || 'true').trim().toLowerCase() === 'true';
const ROUTE_PRICE_STATS_CRON = process.env.ROUTE_PRICE_STATS_CRON || '*/30 * * * *';
const ROUTE_PRICE_STATS_TIMEZONE = process.env.ROUTE_PRICE_STATS_TIMEZONE || FREE_JOBS_TIMEZONE;
const DETECTED_DEALS_ENABLED = String(process.env.DETECTED_DEALS_ENABLED || 'true').trim().toLowerCase() === 'true';
const DETECTED_DEALS_CRON = process.env.DETECTED_DEALS_CRON || '*/20 * * * *';
const DETECTED_DEALS_TIMEZONE = process.env.DETECTED_DEALS_TIMEZONE || FREE_JOBS_TIMEZONE;
const DEALS_CONTENT_ENABLED = String(process.env.DEALS_CONTENT_ENABLED || 'true').trim().toLowerCase() === 'true';
const DEALS_CONTENT_CRON = process.env.DEALS_CONTENT_CRON || '15 8 * * *';
const DEALS_CONTENT_TIMEZONE = process.env.DEALS_CONTENT_TIMEZONE || FREE_JOBS_TIMEZONE;
const DEALS_CONTENT_RUN_ON_STARTUP = String(process.env.DEALS_CONTENT_RUN_ON_STARTUP || 'false').trim().toLowerCase() === 'true';
const PRICE_ALERTS_ENABLED = String(process.env.PRICE_ALERTS_ENABLED || 'true').trim().toLowerCase() === 'true';
const PRICE_ALERTS_CRON = process.env.PRICE_ALERTS_CRON || '*/10 * * * *';
const PRICE_ALERTS_TIMEZONE = process.env.PRICE_ALERTS_TIMEZONE || FREE_JOBS_TIMEZONE;
const PRICE_ALERTS_WORKER_LIMIT_RAW = Number(process.env.PRICE_ALERTS_WORKER_LIMIT || 500);
const PRICE_ALERTS_WORKER_LIMIT = Number.isFinite(PRICE_ALERTS_WORKER_LIMIT_RAW)
  ? Math.max(1, Math.min(5000, PRICE_ALERTS_WORKER_LIMIT_RAW))
  : 500;
const RADAR_MATCH_PRECOMPUTE_CRON = process.env.RADAR_MATCH_PRECOMPUTE_CRON || '*/40 * * * *';
const RADAR_MATCH_PRECOMPUTE_TIMEZONE = process.env.RADAR_MATCH_PRECOMPUTE_TIMEZONE || FREE_JOBS_TIMEZONE;
const FLIGHT_SCAN_ENABLED = String(process.env.FLIGHT_SCAN_ENABLED || 'false').trim().toLowerCase() === 'true';
const FLIGHT_SCAN_SCHEDULER_CRON = process.env.FLIGHT_SCAN_SCHEDULER_CRON || '7 * * * *';
const FLIGHT_SCAN_WORKER_CRON = process.env.FLIGHT_SCAN_WORKER_CRON || '*/5 * * * *';
const FLIGHT_SCAN_TIMEZONE = process.env.FLIGHT_SCAN_TIMEZONE || FREE_JOBS_TIMEZONE;
const PROVIDER_COLLECTION_EFFECTIVE_ENABLED =
  PROVIDER_COLLECTION_ENABLED &&
  !(FLIGHT_SCAN_ENABLED && SCAN_PROVIDER_OVERLAP_POLICY === 'mutual_exclusive');
const BOOTSTRAP_SEED_IMPORT_FILE = String(process.env.BOOTSTRAP_SEED_IMPORT_FILE || '').trim();
const BOOTSTRAP_SEED_IMPORT_DRY_RUN = String(process.env.BOOTSTRAP_SEED_IMPORT_DRY_RUN || 'false').trim().toLowerCase() === 'true';
const JSON_BODY_LIMIT = String(process.env.BODY_JSON_LIMIT || '256kb').trim() || '256kb';
const BUILD_VERSION = String(process.env.BUILD_VERSION || process.env.npm_package_version || '0.0.0-dev').trim();
const OUTBOUND_CLICK_SECRET = String(process.env.OUTBOUND_CLICK_SECRET || process.env.JWT_SECRET || 'dev_outbound_secret').trim();
const OUTBOUND_CLICK_TTL_SECONDS = Number(process.env.OUTBOUND_CLICK_TTL_SECONDS || 300);
const ACCESS_COOKIE_NAME = 'flight_access_token';
const REFRESH_COOKIE_NAME = 'flight_refresh_token';
const ACCESS_COOKIE_TTL_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_COOKIE_DOMAIN = String(process.env.AUTH_COOKIE_DOMAIN || '').trim() || null;
const DEFAULT_CORS_ALLOWLIST = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'];
const ENV_CORS_ALLOWLIST = [process.env.CORS_ORIGIN, process.env.FRONTEND_ORIGIN, process.env.CORS_ALLOWLIST]
  .filter((value) => String(value || '').trim().length > 0)
  .join(',')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const CORS_ALLOWLIST = new Set(ENV_CORS_ALLOWLIST.length > 0 ? ENV_CORS_ALLOWLIST : process.env.NODE_ENV === 'production' ? [] : DEFAULT_CORS_ALLOWLIST);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || process.env.RL_API_PER_MINUTE || 120);
const RL_AUTH_PER_MINUTE = Number(process.env.RL_AUTH_PER_MINUTE || 15);
const RUN_STARTUP_TASKS = String(process.env.RUN_STARTUP_TASKS || 'true').trim().toLowerCase() === 'true';
const CRON_RETRY_ATTEMPTS = Math.max(0, Number(process.env.CRON_RETRY_ATTEMPTS || 1));
const CRON_RETRY_DELAY_MS = Math.max(0, Number(process.env.CRON_RETRY_DELAY_MS || 1500));
const SUBSCRIPTION_SCAN_CACHE_TTL_SEC = Math.max(60, Number(process.env.SUBSCRIPTION_SCAN_CACHE_TTL_SEC || 900));
const SUBSCRIPTION_SCAN_LOCK_TTL_SEC = Math.max(30, Number(process.env.SUBSCRIPTION_SCAN_LOCK_TTL_SEC || 300));
const SHUTDOWN_TIMEOUT_MS = Math.max(1_000, Number(process.env.SHUTDOWN_TIMEOUT_MS || 12_000));
const ALLOW_INSECURE_STARTUP_FOR_TESTS = String(process.env.ALLOW_INSECURE_STARTUP_FOR_TESTS || 'false').trim().toLowerCase() === 'true';
const ALLOW_INSECURE_STARTUP_IN_PRODUCTION = String(process.env.ALLOW_INSECURE_STARTUP_IN_PRODUCTION || 'false').trim().toLowerCase() === 'true';
const INSECURE_STARTUP_BYPASS_ENABLED = ALLOW_INSECURE_STARTUP_FOR_TESTS && ALLOW_INSECURE_STARTUP_IN_PRODUCTION;
const REQUIRE_PRIMARY_INFRA_IN_PRODUCTION = String(process.env.REQUIRE_PRIMARY_INFRA_IN_PRODUCTION || 'true').trim().toLowerCase() !== 'false';
const PRIMARY_INFRA_CHECK_TIMEOUT_MS = Math.max(1_000, Number(process.env.PRIMARY_INFRA_CHECK_TIMEOUT_MS || 5000));
const LOGIN_DUMMY_PASSWORD_HASH =
  '$2b$10$7EqJtq98hPqEX7fNZaFWoOHiA6fQh6J1M4nA4sIY5Pja/qvpDMAYA'; // bcrypt("password")
const TRUST_PROXY_RAW = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
const TRUST_PROXY =
  TRUST_PROXY_RAW === '' || TRUST_PROXY_RAW === 'false' || TRUST_PROXY_RAW === '0'
    ? false
    : TRUST_PROXY_RAW === 'true'
    ? 1
    : Number.isFinite(Number(TRUST_PROXY_RAW))
    ? Number(TRUST_PROXY_RAW)
    : TRUST_PROXY_RAW;

app.set('trust proxy', TRUST_PROXY);
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use((req, res, next) => {
  res.on('finish', () => {
    if (![401, 403, 429].includes(res.statusCode)) return;
    logger.warn(
      {
        request_id: req.id || null,
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        ip: req.ip || req.socket?.remoteAddress || null
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
  return res.status(status).json(payload);
}

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
app.use('/api/auth', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', standardApiLimiter);
app.use('/api', apiKeyAuth);
app.use('/', buildFreeFoundationRouter({ corsAllowlist: Array.from(CORS_ALLOWLIST) }));
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

const REGION_ENUM = ['all', 'eu', 'asia', 'america', 'oceania'];
const CABIN_ENUM = ['economy', 'premium', 'business'];
const CONNECTION_ENUM = ['all', 'direct', 'with_stops'];
const TRAVEL_TIME_ENUM = ['all', 'day', 'night'];
const EXTERNAL_FLIGHT_PARTNERS_ENABLED = String(process.env.ENABLE_EXTERNAL_FLIGHT_PARTNERS || 'false').trim().toLowerCase() === 'true';
const flightProviderRegistry = createFlightProviderRegistry({
  enableExternalPartners: EXTERNAL_FLIGHT_PARTNERS_ENABLED,
  outboundAllowedHostsEnv: process.env.OUTBOUND_ALLOWED_HOSTS,
  resolveBookingUrl: ({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass }) =>
    buildBookingLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass })
});
const dataProviderRegistry = createProviderRegistry();
const scanStatusService = createScanStatusService({ providerRegistry: dataProviderRegistry });
if (PROVIDER_COLLECTION_ENABLED && !PROVIDER_COLLECTION_EFFECTIVE_ENABLED) {
  logger.warn(
    { overlapPolicy: SCAN_PROVIDER_OVERLAP_POLICY, flightScanEnabled: FLIGHT_SCAN_ENABLED, providerCollectionEnabled: PROVIDER_COLLECTION_ENABLED },
    'provider_collection_disabled_due_to_overlap_policy'
  );
}
const startupReadiness = evaluateStartupReadiness();
const runtimeConfigAudit = startupReadiness.runtimeAudit;

function withInfraTimeout(promise, timeoutMs, label) {
  const safeTimeoutMs = Math.max(500, Number(timeoutMs) || 5000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}_timeout`));
    }, safeTimeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function verifyPrimaryInfrastructureOrFail() {
  const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (!isProduction || !REQUIRE_PRIMARY_INFRA_IN_PRODUCTION) return;

  const failures = [];
  if (!pgPool) {
    failures.push('postgres_not_configured');
  } else {
    try {
      await withInfraTimeout(pgPool.query('SELECT 1'), PRIMARY_INFRA_CHECK_TIMEOUT_MS, 'postgres');
    } catch (error) {
      failures.push(`postgres_unreachable:${error?.message || String(error)}`);
    }
  }

  const redisUrlConfigured = Boolean(String(process.env.REDIS_URL || '').trim());
  if (!redisUrlConfigured) {
    failures.push('redis_not_configured');
  } else {
    try {
      const cache = getCacheClient();
      if (typeof cache?.ping !== 'function') {
        failures.push('redis_ping_not_supported');
      } else {
        await withInfraTimeout(cache.ping(), PRIMARY_INFRA_CHECK_TIMEOUT_MS, 'redis');
      }
    } catch (error) {
      failures.push(`redis_unreachable:${error?.message || String(error)}`);
    }
  }

  if (failures.length === 0) return;
  if (!INSECURE_STARTUP_BYPASS_ENABLED) {
    logger.fatal(
      {
        failures,
        requirePrimaryInfraInProduction: REQUIRE_PRIMARY_INFRA_IN_PRODUCTION,
        primaryInfraCheckTimeoutMs: PRIMARY_INFRA_CHECK_TIMEOUT_MS
      },
      'startup_blocked_primary_infra_unavailable'
    );
    process.exit(1);
  }

  logger.warn(
    {
      failures,
      allowInsecureStartupForTests: ALLOW_INSECURE_STARTUP_FOR_TESTS,
      allowInsecureStartupInProduction: ALLOW_INSECURE_STARTUP_IN_PRODUCTION,
      requirePrimaryInfraInProduction: REQUIRE_PRIMARY_INFRA_IN_PRODUCTION
    },
    'startup_primary_infra_unavailable_bypass_enabled'
  );
}

await verifyPrimaryInfrastructureOrFail();
if (!startupReadiness.ok && process.env.NODE_ENV === 'production') {
  if (!INSECURE_STARTUP_BYPASS_ENABLED) {
    logger.fatal(
      {
        blockingRuntimeMissing: startupReadiness.blockingFailed.runtime,
        blockingPolicyMissing: startupReadiness.blockingFailed.policy,
        summary: startupReadiness.summary
      },
      'startup_blocked_missing_required_runtime_config'
    );
    process.exit(1);
  }
  logger.warn(
    {
      allowInsecureStartupForTests: ALLOW_INSECURE_STARTUP_FOR_TESTS,
      allowInsecureStartupInProduction: ALLOW_INSECURE_STARTUP_IN_PRODUCTION,
      blockingRuntimeMissing: startupReadiness.blockingFailed.runtime,
      blockingPolicyMissing: startupReadiness.blockingFailed.policy,
      summary: startupReadiness.summary
    },
    'startup_insecure_bypass_enabled_for_tests'
  );
}
if (runtimeConfigAudit.summary.recommendedFailed > 0) {
  logger.warn(
    {
      recommendedMissing: runtimeConfigAudit.recommendedFailedKeys,
      summary: runtimeConfigAudit.summary
    },
    'runtime_config_recommended_values_missing'
  );
}
if (startupReadiness.recommendedFailed.policy.length > 0) {
  logger.warn(
    {
      recommendedPolicyMissing: startupReadiness.recommendedFailed.policy,
      policySummary: startupReadiness.summary.policy
    },
    'runtime_policy_recommended_values_missing'
  );
}
const PARTNER_ENUM = flightProviderRegistry.allowedPartners;
const OUTBOUND_SURFACE_ENUM = ['results', 'top_picks', 'compare', 'watchlist', 'insights'];
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

const DEFAULT_AI_TOKEN_COSTS = {
  openai: {
    inputPer1M: Number(process.env.OPENAI_INPUT_COST_PER_1M || 0.15),
    outputPer1M: Number(process.env.OPENAI_OUTPUT_COST_PER_1M || 0.6)
  },
  claude: {
    inputPer1M: Number(process.env.ANTHROPIC_INPUT_COST_PER_1M || 3),
    outputPer1M: Number(process.env.ANTHROPIC_OUTPUT_COST_PER_1M || 15)
  }
};

const PLAN_TOKEN_USAGE = {
  pro: { monthlyInputTokens: 2200000, monthlyOutputTokens: 480000, openaiShare: 0.72 },
  creator: { monthlyInputTokens: 6200000, monthlyOutputTokens: 1600000, openaiShare: 0.62 }
};

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email(),
  password: z
    .string()
    .min(10)
    .max(64)
    .regex(/[a-z]/, 'Password must include a lowercase letter.')
    .regex(/[A-Z]/, 'Password must include an uppercase letter.')
    .regex(/[0-9]/, 'Password must include a number.')
    .regex(/[^A-Za-z0-9]/, 'Password must include a special character.')
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(64)
});

const passwordResetRequestSchema = z.object({
  email: z.string().email()
});

const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(32).max(256),
  password: z
    .string()
    .min(10)
    .max(64)
    .regex(/[a-z]/, 'Password must include a lowercase letter.')
    .regex(/[A-Z]/, 'Password must include an uppercase letter.')
    .regex(/[0-9]/, 'Password must include a number.')
    .regex(/[^A-Za-z0-9]/, 'Password must include a special character.')
});

const mfaCodeSchema = z.object({
  code: z.string().trim().min(6).max(8)
});

const loginMfaVerifySchema = z.object({
  ticket: z.string().min(10).max(80),
  code: z.string().trim().min(6).max(8)
});

const oauthLoginSchema = z.object({
  idToken: z.string().min(20),
  oauthSessionId: z.string().min(10).max(80),
  state: z.string().min(10).max(120).optional()
});

const oauthSessionSchema = z.object({
  provider: z.enum(['google', 'apple', 'facebook'])
});

const onboardingCompleteSchema = z.object({
  intent: z.enum(['deals', 'family', 'business', 'weekend']).optional(),
  budget: z.number().int().positive().max(20000).optional(),
  preferredRegion: z.enum(REGION_ENUM).optional(),
  directOnly: z.boolean().optional()
});

const searchSchema = z
  .object({
    origin: z.string().min(3).max(3),
    region: z.enum(REGION_ENUM),
    country: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text;
      },
      z.string().min(1).max(80).optional()
    ),
    destinationQuery: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text;
      },
      z.string().min(1).max(80).optional()
    ),
    dateFrom: z.string(),
    dateTo: z.string().optional(),
    cheapOnly: z.boolean(),
    maxBudget: z.number().int().positive().optional(),
    connectionType: z.enum(CONNECTION_ENUM),
    maxStops: z.number().int().min(0).max(2).optional(),
    travelTime: z.enum(TRAVEL_TIME_ENUM),
    minComfortScore: z.number().int().min(1).max(100).optional(),
    travellers: z.number().int().min(1).max(9),
    cabinClass: z.enum(CABIN_ENUM)
  })
  .superRefine((payload, ctx) => {
    const from = new Date(payload.dateFrom);
    const to = payload.dateTo ? new Date(payload.dateTo) : null;
    if (Number.isNaN(from.getTime()) || (to && Number.isNaN(to.getTime()))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid travel dates.' });
      return;
    }
    if (to && to <= from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Return date must be after departure date.' });
    }
  });

const justGoSchema = z
  .object({
    origin: z.string().min(3).max(3),
    region: z.enum(REGION_ENUM).optional(),
    country: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text;
      },
      z.string().min(1).max(80).optional()
    ),
    dateFrom: z.string(),
    dateTo: z.string(),
    tripLengthDays: z.number().int().min(2).max(21),
    budgetMax: z.number().int().min(150).max(25000),
    travellers: z.number().int().min(1).max(9),
    cabinClass: z.enum(CABIN_ENUM),
    mood: z.enum(['relax', 'natura', 'party', 'cultura', 'avventura']),
    climatePreference: z.enum(['warm', 'mild', 'cold', 'indifferent']),
    pace: z.enum(['slow', 'normal', 'fast']),
    avoidOvertourism: z.boolean().optional(),
    packageCount: z.union([z.literal(3), z.literal(4)]).optional(),
    aiProvider: z.enum(['none', 'chatgpt', 'claude', 'auto']).optional()
  })
  .superRefine((payload, ctx) => {
    const from = new Date(payload.dateFrom);
    const to = new Date(payload.dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid travel dates.' });
      return;
    }
    if (to <= from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Return date must be after departure date.' });
    }
  });

const decisionIntakeSchema = z.object({
  prompt: z.string().trim().min(6).max(1200),
  aiProvider: z.enum(['none', 'chatgpt', 'claude', 'auto']).optional(),
  packageCount: z.union([z.literal(3), z.literal(4)]).optional()
});

const watchlistSchema = z.object({
  flightId: z.string().min(1),
  destination: z.string().min(1),
  destinationIata: z.string().min(3).max(3),
  price: z.number().positive(),
  dateFrom: z.string(),
  dateTo: z.string(),
  link: z.string().url()
});

const alertSubscriptionSchema = z.object({
  origin: z.string().min(3).max(3),
  region: z.enum(REGION_ENUM),
  country: z.preprocess(
    (value) => {
      const text = String(value ?? '').trim();
      return text === '' ? undefined : text;
    },
    z.string().min(1).max(80).optional()
  ),
  destinationQuery: z.preprocess(
    (value) => {
      const text = String(value ?? '').trim();
      return text === '' ? undefined : text;
    },
    z.string().min(1).max(80).optional()
  ),
  destinationIata: z.string().length(3).optional(),
  targetPrice: z.number().int().positive().optional(),
  connectionType: z.enum(CONNECTION_ENUM),
  maxStops: z.number().int().min(0).max(2).optional(),
  travelTime: z.enum(TRAVEL_TIME_ENUM),
  minComfortScore: z.number().int().min(1).max(100).optional(),
  cheapOnly: z.boolean(),
  travellers: z.number().int().min(1).max(9),
  cabinClass: z.enum(CABIN_ENUM),
  stayDays: z.number().int().min(2).max(30),
  daysFromNow: z.number().int().min(1).max(180).optional()
});

const alertSubscriptionUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    targetPrice: z.number().int().positive().nullable().optional(),
    connectionType: z.enum(CONNECTION_ENUM).optional(),
    maxStops: z.number().int().min(0).max(2).nullable().optional(),
    travelTime: z.enum(TRAVEL_TIME_ENUM).optional(),
    minComfortScore: z.number().int().min(1).max(100).nullable().optional(),
    cheapOnly: z.boolean().optional(),
    travellers: z.number().int().min(1).max(9).optional(),
    cabinClass: z.enum(CABIN_ENUM).optional(),
    stayDays: z.number().int().min(2).max(30).optional(),
    daysFromNow: z.number().int().min(1).max(180).nullable().optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'No update field provided.'
  });

const destinationInsightSchema = z
  .object({
    origin: z.string().min(3).max(3),
    region: z.enum(REGION_ENUM),
    country: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text;
      },
      z.string().min(1).max(80).optional()
    ),
    destinationQuery: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text;
      },
      z.string().min(1).max(80).optional()
    ),
    destinationIata: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text.toUpperCase();
      },
      z.string().length(3).optional()
    ),
    cheapOnly: z.boolean(),
    maxBudget: z.number().int().positive().optional(),
    connectionType: z.enum(CONNECTION_ENUM),
    maxStops: z.number().int().min(0).max(2).optional(),
    travelTime: z.enum(TRAVEL_TIME_ENUM),
    minComfortScore: z.number().int().min(1).max(100).optional(),
    travellers: z.number().int().min(1).max(9),
    cabinClass: z.enum(CABIN_ENUM),
    stayDays: z.number().int().min(2).max(30),
    horizonDays: z.number().int().min(7).max(180).optional()
  })
  .superRefine((payload, ctx) => {
    if (!payload.destinationQuery && !payload.destinationIata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide destinationQuery or destinationIata.'
      });
    }
  });

const partnerSchema = z.string().refine((value) => PARTNER_ENUM.includes(String(value || '')), {
  message: `Unsupported outbound partner. Allowed: ${PARTNER_ENUM.join(', ')}`
});

const outboundClickSchema = z.object({
  partner: partnerSchema,
  url: z.string().url(),
  surface: z.enum(OUTBOUND_SURFACE_ENUM),
  origin: z.string().min(3).max(3),
  destinationIata: z.string().min(3).max(3),
  destination: z.string().min(1).max(80),
  stopCount: z.number().int().min(0).max(2).optional(),
  comfortScore: z.number().int().min(1).max(100).optional(),
  connectionType: z.enum(CONNECTION_ENUM).optional(),
  travelTime: z.enum(TRAVEL_TIME_ENUM).optional(),
  utmSource: z.string().max(80).optional(),
  utmMedium: z.string().max(80).optional(),
  utmCampaign: z.string().max(120).optional()
});

const outboundResolveSchema = z
  .object({
    partner: partnerSchema.default('tde_booking'),
    surface: z.enum(OUTBOUND_SURFACE_ENUM),
    origin: z.string().min(3).max(3),
    destinationIata: z.string().min(3).max(3),
    destination: z.string().min(1).max(80).optional(),
    dateFrom: z.string(),
    dateTo: z.string(),
    travellers: z.preprocess((value) => Number(value), z.number().int().min(1).max(9)).default(1),
    cabinClass: z.enum(CABIN_ENUM).default('economy'),
    stopCount: z.preprocess(
      (value) => {
        if (value === '' || value === undefined || value === null) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      },
      z.number().int().min(0).max(2).optional()
    ),
    comfortScore: z.preprocess(
      (value) => {
        if (value === '' || value === undefined || value === null) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      },
      z.number().int().min(1).max(100).optional()
    ),
    connectionType: z.enum(CONNECTION_ENUM).optional(),
    travelTime: z.enum(TRAVEL_TIME_ENUM).optional(),
    utmSource: z.string().max(80).optional(),
    utmMedium: z.string().max(80).optional(),
    utmCampaign: z.string().max(120).optional()
  })
  .superRefine((payload, ctx) => {
    const from = parseISO(payload.dateFrom);
    const to = parseISO(payload.dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid travel dates.' });
      return;
    }
    if (from.getTime() >= to.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'dateTo must be later than dateFrom.' });
    }
  });

function getTokenFromHeader(req) {
  const raw = req.headers.authorization;
  if (!raw) return null;
  const [prefix, token] = raw.split(' ');
  if (prefix !== 'Bearer' || !token) return null;
  return token;
}

function getCookies(req) {
  const raw = String(req.headers.cookie || '');
  if (!raw) return {};
  return raw.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
}

function getAccessTokenFromCookie(req) {
  const cookies = getCookies(req);
  return cookies[ACCESS_COOKIE_NAME] || null;
}

function getRefreshTokenFromCookie(req) {
  const cookies = getCookies(req);
  return cookies[REFRESH_COOKIE_NAME] || null;
}

function getAuthToken(req) {
  const headerToken = getTokenFromHeader(req);
  if (headerToken) return { token: headerToken, source: 'bearer' };
  const cookieToken = getAccessTokenFromCookie(req);
  if (cookieToken) return { token: cookieToken, source: 'cookie' };
  return { token: null, source: null };
}

function ensureAllowedOutboundUrl(rawUrl) {
  return flightProviderRegistry.ensureAllowedUrl(rawUrl);
}

function resolveOutboundPartnerUrl({
  partner,
  origin,
  destinationIata,
  dateFrom,
  dateTo,
  travellers,
  cabinClass,
  utmSource,
  utmMedium,
  utmCampaign
}) {
  return flightProviderRegistry.resolveOutboundPartnerUrl({
    partner,
    origin,
    destinationIata,
    dateFrom,
    dateTo,
    travellers,
    cabinClass,
    utmSource,
    utmMedium,
    utmCampaign
  });
}

function createOutboundClickToken({ clickId, targetUrl, expiresAt }) {
  const payload = `${clickId}|${targetUrl}|${expiresAt}`;
  return createHmac('sha256', OUTBOUND_CLICK_SECRET).update(payload).digest('hex');
}

function verifyOutboundClickToken({ clickId, targetUrl, expiresAt, clickToken }) {
  const expected = createOutboundClickToken({ clickId, targetUrl, expiresAt });
  return expected === clickToken;
}

function isSecureRequest(req) {
  return Boolean(req.secure);
}

function authCookieOptions(req, maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(isSecureRequest(req) || process.env.NODE_ENV === 'production'),
    path: '/',
    maxAge: maxAgeMs,
    ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {})
  };
}

async function isRevokedJti(jti) {
  if (!jti) return false;
  const db = await readDb();
  const nowSec = Math.floor(Date.now() / 1000);
  return (db.revokedTokens || []).some((entry) => entry.jti === jti && (!Number.isFinite(entry.exp) || entry.exp > nowSec));
}

async function revokeJwt(payload) {
  if (!payload?.jti) return;
  await withDb(async (db) => {
    const nowSec = Math.floor(Date.now() / 1000);
    db.revokedTokens = (db.revokedTokens || []).filter((entry) => !Number.isFinite(entry.exp) || entry.exp > nowSec);
    db.revokedTokens.push({
      id: nanoid(10),
      jti: payload.jti,
      exp: Number.isFinite(payload.exp) ? payload.exp : nowSec + 7 * 24 * 60 * 60,
      revokedAt: new Date().toISOString()
    });
    db.revokedTokens = db.revokedTokens.slice(-5000);
    return db;
  });
}

async function createRefreshSession({ userId, family, jti, exp }) {
  await withDb(async (db) => {
    db.refreshSessions = (db.refreshSessions || []).filter((s) => !s.exp || s.exp > Math.floor(Date.now() / 1000));
    db.refreshSessions.push({
      id: nanoid(10),
      userId,
      family,
      jti,
      exp,
      issuedAt: new Date().toISOString(),
      revokedAt: null,
      rotatedTo: null
    });
    db.refreshSessions = db.refreshSessions.slice(-10000);
    return db;
  });
}

async function revokeRefreshFamily(family, reason = 'manual') {
  await withDb(async (db) => {
    for (const session of db.refreshSessions || []) {
      if (session.family === family && !session.revokedAt) {
        session.revokedAt = new Date().toISOString();
        session.revokeReason = reason;
      }
    }
    return db;
  });
}

async function rotateRefreshSession({ oldJti, newJti, userId, family, exp }) {
  let oldSession = null;
  await withDb(async (db) => {
    oldSession = (db.refreshSessions || []).find((session) => session.jti === oldJti) || null;
    if (!oldSession || oldSession.userId !== userId || oldSession.family !== family || oldSession.revokedAt) {
      return db;
    }
    oldSession.revokedAt = new Date().toISOString();
    oldSession.rotatedTo = newJti;
    db.refreshSessions.push({
      id: nanoid(10),
      userId,
      family,
      jti: newJti,
      exp,
      issuedAt: new Date().toISOString(),
      revokedAt: null,
      rotatedTo: null
    });
    db.refreshSessions = db.refreshSessions.slice(-10000);
    return db;
  });
  return oldSession;
}

function optionalAuth(req) {
  try {
    const { token } = getAuthToken(req);
    if (!token) return null;
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

function isTrustedOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (origin) return CORS_ALLOWLIST.has(origin);
  const referer = String(req.headers.referer || '').trim();
  if (!referer) return false;
  try {
    const refererOrigin = new URL(referer).origin;
    return CORS_ALLOWLIST.has(refererOrigin);
  } catch {
    return false;
  }
}

function userIsLocked(user) {
  if (!user?.lockUntil) return false;
  const lockTs = new Date(user.lockUntil).getTime();
  return Number.isFinite(lockTs) && lockTs > Date.now();
}

function resetUserLoginFailures(user) {
  user.failedLoginCount = 0;
  user.lockUntil = null;
}

function registerFailedLogin(user) {
  const nextCount = Number.isFinite(user.failedLoginCount) ? user.failedLoginCount + 1 : 1;
  user.failedLoginCount = nextCount;
  if (nextCount >= LOGIN_MAX_FAILURES) {
    const lockUntil = new Date();
    lockUntil.setMinutes(lockUntil.getMinutes() + LOGIN_LOCK_MINUTES);
    user.lockUntil = lockUntil.toISOString();
    user.failedLoginCount = 0;
  }
}

function getClientIp(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
  return ip || 'unknown';
}

function hashPasswordResetToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

function buildPasswordResetUrl(rawToken) {
  const base = process.env.PASSWORD_RESET_URL || `${FRONTEND_URL}/`;
  const url = new URL(base);
  url.searchParams.set('reset_token', rawToken);
  return url.toString();
}

async function logAuthEvent({ userId = null, email = '', type, success, req, detail = '' }) {
  const event = {
    id: nanoid(10),
    at: new Date().toISOString(),
    userId,
    email: String(email || '').toLowerCase(),
    type,
    success: Boolean(success),
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 220),
    detail
  };

  await withDb(async (db) => {
    db.authEvents.push(event);
    db.authEvents = db.authEvents.slice(-3000);
    return db;
  });
  appendImmutableAudit({
    category: 'auth_event',
    userId,
    email: String(email || '').toLowerCase(),
    type,
    success: Boolean(success),
    ip: event.ip,
    detail
  }).catch(() => {});
}

function roundPriceForDisplay(value) {
  const base = Math.max(4.99, Number(value || 0));
  const rounded = Math.ceil(base);
  return Number((rounded - 0.01).toFixed(2));
}

function estimatePlanApiCostEur(tokenCosts, planKey) {
  const plan = PLAN_TOKEN_USAGE[planKey];
  if (!plan) return 0;
  const openaiShare = Math.max(0, Math.min(1, plan.openaiShare));
  const claudeShare = 1 - openaiShare;
  const usageGrowth = Math.max(1, Number.isFinite(AI_USAGE_GROWTH_FACTOR) ? AI_USAGE_GROWTH_FACTOR : 1);
  const inputM = (plan.monthlyInputTokens * usageGrowth) / 1_000_000;
  const outputM = (plan.monthlyOutputTokens * usageGrowth) / 1_000_000;
  const openaiCost = inputM * tokenCosts.openai.inputPer1M + outputM * tokenCosts.openai.outputPer1M;
  const claudeCost = inputM * tokenCosts.claude.inputPer1M + outputM * tokenCosts.claude.outputPer1M;
  return openaiCost * openaiShare + claudeCost * claudeShare;
}

async function fetchAiTokenCosts() {
  const safeDefaults = {
    openai: {
      inputPer1M: Number(DEFAULT_AI_TOKEN_COSTS.openai.inputPer1M),
      outputPer1M: Number(DEFAULT_AI_TOKEN_COSTS.openai.outputPer1M)
    },
    claude: {
      inputPer1M: Number(DEFAULT_AI_TOKEN_COSTS.claude.inputPer1M),
      outputPer1M: Number(DEFAULT_AI_TOKEN_COSTS.claude.outputPer1M)
    },
    source: 'env-default',
    checkedAt: new Date().toISOString()
  };

  if (!AI_COST_FEED_URL) return safeDefaults;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(AI_COST_FEED_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return safeDefaults;
      const openaiInput = Number(payload?.openai?.inputPer1M);
      const openaiOutput = Number(payload?.openai?.outputPer1M);
      const claudeInput = Number(payload?.claude?.inputPer1M);
      const claudeOutput = Number(payload?.claude?.outputPer1M);
      if (![openaiInput, openaiOutput, claudeInput, claudeOutput].every((v) => Number.isFinite(v) && v > 0)) {
        return safeDefaults;
      }
      return {
        openai: { inputPer1M: openaiInput, outputPer1M: openaiOutput },
        claude: { inputPer1M: claudeInput, outputPer1M: claudeOutput },
        source: 'remote-feed',
        checkedAt: new Date().toISOString()
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return safeDefaults;
  }
}

function buildRecommendedPricing(tokenCosts) {
  const proCost = estimatePlanApiCostEur(tokenCosts, 'pro');
  const creatorCost = estimatePlanApiCostEur(tokenCosts, 'creator');

  const marginDivisor = Math.max(0.05, 1 - Math.max(0.25, Math.min(0.9, AI_TARGET_MARGIN)));
  const proRaw = (proCost + AI_PLATFORM_OVERHEAD_EUR + AI_SAFETY_BUFFER_EUR) / marginDivisor;
  const creatorRaw = (creatorCost + AI_PLATFORM_OVERHEAD_EUR * 1.8 + AI_SAFETY_BUFFER_EUR * 1.4) / marginDivisor;

  return {
    free: { monthlyEur: 0 },
    pro: { monthlyEur: roundPriceForDisplay(proRaw) },
    creator: { monthlyEur: roundPriceForDisplay(Math.max(creatorRaw, proRaw + 8)) }
  };
}

async function monitorAndUpdateSubscriptionPricing({ reason = 'cron' } = {}) {
  const tokenCosts = await fetchAiTokenCosts();
  const recommended = buildRecommendedPricing(tokenCosts);
  let updated = false;
  let snapshot = null;

  await withDb(async (db) => {
    const current = db.subscriptionPricing || {
      free: { monthlyEur: 0 },
      pro: { monthlyEur: 12.99 },
      creator: { monthlyEur: 29.99 }
    };
    const currentPro = Number(current?.pro?.monthlyEur || recommended.pro.monthlyEur);
    const currentCreator = Number(current?.creator?.monthlyEur || recommended.creator.monthlyEur);
    const nextPro = Number(recommended.pro.monthlyEur);
    const nextCreator = Number(recommended.creator.monthlyEur);

    const proShouldIncrease = nextPro > currentPro + 0.009;
    const creatorShouldIncrease = nextCreator > currentCreator + 0.009;
    const proShouldDecrease = currentPro - nextPro >= 0.5;
    const creatorShouldDecrease = currentCreator - nextCreator >= 0.5;
    updated = proShouldIncrease || creatorShouldIncrease || proShouldDecrease || creatorShouldDecrease;

    db.subscriptionPricing = {
      free: { monthlyEur: 0 },
      pro: { monthlyEur: proShouldIncrease || proShouldDecrease ? nextPro : currentPro },
      creator: {
        monthlyEur: creatorShouldIncrease || creatorShouldDecrease ? nextCreator : currentCreator
      },
      updatedAt: updated ? new Date().toISOString() : current.updatedAt || null,
      lastCostCheckAt: new Date().toISOString(),
      marginTarget: AI_TARGET_MARGIN,
      usageGrowthFactor: AI_USAGE_GROWTH_FACTOR
    };

    db.aiCostSnapshots = db.aiCostSnapshots || [];
    snapshot = {
      id: nanoid(10),
      at: new Date().toISOString(),
      reason,
      source: tokenCosts.source,
      tokenCosts: {
        openai: tokenCosts.openai,
        claude: tokenCosts.claude
      },
      usageGrowthFactor: AI_USAGE_GROWTH_FACTOR,
      recommended,
      applied: db.subscriptionPricing
    };
    db.aiCostSnapshots.push(snapshot);
    db.aiCostSnapshots = db.aiCostSnapshots.slice(-500);
    return db;
  });

  appendImmutableAudit({
    category: 'ai_pricing_check',
    type: updated ? 'pricing_updated' : 'pricing_checked',
    success: true,
    detail: `reason=${reason}; pro=${recommended.pro.monthlyEur}; creator=${recommended.creator.monthlyEur}; source=${tokenCosts.source}; usageGrowth=${AI_USAGE_GROWTH_FACTOR}`
  }).catch(() => {});

  return {
    ok: true,
    updated,
    snapshot
  };
}

async function ensureAiPremiumAccess(req, aiProvider) {
  const provider = String(aiProvider || 'none').toLowerCase();
  if (provider === 'none') return { allowed: true };
  const userId = req.user?.id || req.user?.sub;
  if (!userId) return { allowed: false, status: 401, error: 'auth_required' };
  const sub = await getOrCreateSubscription(userId);
  const planId = String(sub?.planId || 'free').toLowerCase();
  if (planId !== 'creator') return { allowed: false, status: 402, error: 'premium_required' };
  return { allowed: true };
}

async function authGuard(req, res, next) {
  try {
    if (req.user?.id || req.user?.sub) {
      if (!req.authSource) req.authSource = req.apiKeyId ? 'api_key' : 'bearer';
      return next();
    }
    const { token, source } = getAuthToken(req);
    if (!token) return sendMachineError(req, res, 401, 'auth_required');

    const payload = verifyAccessToken(token);
    if (await isRevokedJti(payload.jti)) {
      logger.warn(
        {
          request_id: req.id || null,
          method: req.method,
          path: req.originalUrl || req.url,
          status: 401,
          user_id: payload.sub || null
        },
        'security_token_revoked'
      );
      return sendMachineError(req, res, 401, 'token_revoked');
    }
    req.user = payload;
    req.authToken = token;
    req.authSource = source;
    return next();
  } catch {
    return sendMachineError(req, res, 401, 'auth_invalid');
  }
}

function csrfGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.authSource !== 'cookie') return next();
  if (!isTrustedOrigin(req)) return sendMachineError(req, res, 403, 'request_forbidden');

  const csrfHeader = String(req.headers['x-csrf-token'] || '').trim();
  const csrfClaim = String(req.user?.csrf || '').trim();
  if (!csrfHeader || !csrfClaim || csrfHeader !== csrfClaim) {
    return sendMachineError(req, res, 403, 'csrf_failed');
  }
  return next();
}

async function fetchCurrentUser(userId) {
  let user = null;
  await withDb(async (db) => {
    user = db.users.find((item) => item.id === userId) || null;
    return null;
  });
  return user;
}

async function premiumGuard(req, res, next) {
  const user = await fetchCurrentUser(req.user.sub);
  if (!user) return sendMachineError(req, res, 404, 'user_not_found');
  if (!canUseAITravel(user)) return sendMachineError(req, res, 402, 'premium_required');
  req.currentUser = user;
  return next();
}

async function issueSessionTokens({ req, res, user, csrfToken, family }) {
  const authChannel = String(user.authChannel || 'direct');
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    csrf: csrfToken,
    amr: user.mfaEnabled ? ['pwd', 'otp'] : ['pwd'],
    authChannel
  });
  const decodedAccess = verifyAccessToken(accessToken);
  const refreshToken = signRefreshToken({ sub: user.id, family, csrf: csrfToken, authChannel });
  const decodedRefresh = verifyRefreshToken(refreshToken);

  await createRefreshSession({
    userId: user.id,
    family,
    jti: decodedRefresh.jti,
    exp: Number(decodedRefresh.exp || 0)
  });

  res.cookie(ACCESS_COOKIE_NAME, accessToken, authCookieOptions(req, ACCESS_COOKIE_TTL_MS));
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, authCookieOptions(req, REFRESH_COOKIE_TTL_MS));
  return {
    accessToken,
    refreshToken,
    decodedAccess,
    decodedRefresh
  };
}

function refreshCsrfGuard(req, payload) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin || !isTrustedOrigin(req)) return { ok: false, code: 'request_forbidden' };
  const csrfHeader = String(req.headers['x-csrf-token'] || '').trim();
  if (!csrfHeader || csrfHeader !== String(payload?.csrf || '')) return { ok: false, code: 'csrf_failed' };
  return { ok: true };
}

function toBase64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildPkcePair() {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return { verifier, challenge };
}

async function createOAuthSession(provider, redirectUri) {
  const ttlMs = Math.max(60, Math.min(900, OAUTH_SESSION_TTL_SECONDS)) * 1000;
  const pkce = buildPkcePair();
  const session = {
    id: nanoid(24),
    provider,
    state: nanoid(32),
    nonce: nanoid(32),
    codeVerifier: pkce.verifier,
    codeChallenge: pkce.challenge,
    redirectUri,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    consumedAt: null
  };
  await withDb(async (db) => {
    db.oauthSessions = (db.oauthSessions || [])
      .filter((item) => new Date(item.expiresAt).getTime() > Date.now())
      .slice(-4000);
    db.oauthSessions.push(session);
    return db;
  });
  return session;
}

async function consumeOAuthSessionById({ id, provider, state }) {
  let session = null;
  await withDb(async (db) => {
    session = (db.oauthSessions || []).find((item) => item.id === id && item.provider === provider && !item.consumedAt) || null;
    if (!session) return db;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return db;
    if (state && session.state !== state) return db;
    session.consumedAt = new Date().toISOString();
    return db;
  });
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  if (state && session.state !== state) return null;
  return session;
}

async function consumeOAuthSessionByState({ provider, state }) {
  let session = null;
  await withDb(async (db) => {
    session = (db.oauthSessions || []).find((item) => item.provider === provider && item.state === state && !item.consumedAt) || null;
    if (!session) return db;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return db;
    session.consumedAt = new Date().toISOString();
    return db;
  });
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return session;
}

async function findOrCreateOAuthUser(profile) {
  const oauthChannel = profile.provider === 'google' ? 'oauth_google' : profile.provider === 'apple' ? 'oauth_apple' : profile.provider === 'facebook' ? 'oauth_facebook' : 'direct';
  let user = null;
  await withDb(async (db) => {
    const byEmail = db.users.find((item) => item.email === profile.email) || null;
    if (byEmail) {
      byEmail.name = byEmail.name || profile.name;
      byEmail.isPremium = Boolean(byEmail.isPremium);
      byEmail.planType = resolveUserPlan(byEmail).planType;
      byEmail.planStatus = resolveUserPlan(byEmail).planStatus;
      byEmail.onboardingDone = Boolean(byEmail.onboardingDone);
      byEmail.authChannel = oauthChannel;
      byEmail.oauthProviders = byEmail.oauthProviders || [];
      const alreadyLinked = byEmail.oauthProviders.some((p) => p.provider === profile.provider && p.subject === profile.providerSubject);
      if (!alreadyLinked) {
        byEmail.oauthProviders.push({
          provider: profile.provider,
          subject: profile.providerSubject,
          linkedAt: new Date().toISOString()
        });
      }
      user = byEmail;
      return db;
    }

    const created = {
      id: nanoid(10),
      name: profile.name,
      email: profile.email,
      passwordHash: null,
      isPremium: false,
      planType: 'free',
      planStatus: 'active',
      onboardingDone: false,
      mfaEnabled: false,
      mfaSecret: null,
      mfaTempSecret: null,
      failedLoginCount: 0,
      lockUntil: null,
      authChannel: oauthChannel,
      oauthProviders: [
        {
          provider: profile.provider,
          subject: profile.providerSubject,
          linkedAt: new Date().toISOString()
        }
      ],
      createdAt: new Date().toISOString()
    };
    db.users.push(created);
    user = created;
    return db;
  });
  return user;
}

async function completeOAuthLogin({ req, res, profile }) {
  const user = await findOrCreateOAuthUser(profile);
  const csrfToken = nanoid(24);
  const family = nanoid(16);
  const { accessToken } = await issueSessionTokens({ req, res, user, csrfToken, family });
  const channel = profile.provider === 'google' ? 'oauth_google' : profile.provider === 'apple' ? 'oauth_apple' : 'oauth_facebook';
  await upsertUserLead({ userId: user.id, email: user.email, name: user.name, source: channel, channel });
  await logAuthEvent({
    userId: user.id,
    email: user.email,
    type: `${channel}_login_success`,
    success: true,
    req
  });
  return {
    token: accessToken,
    session: { cookie: true, expiresInDays: 7, csrfToken },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      mfaEnabled: Boolean(user.mfaEnabled),
      isPremium: Boolean(user.isPremium),
      planType: resolveUserPlan(user).planType,
      planStatus: resolveUserPlan(user).planStatus,
      onboardingDone: Boolean(user.onboardingDone)
    }
  };
}

function buildDestinationInsights(params) {
  const horizonDays = Number.isFinite(params.horizonDays) ? params.horizonDays : 120;
  const windows = [];

  for (let offset = 1; offset <= horizonDays; offset += 1) {
    const from = addDays(new Date(), offset);
    const to = addDays(from, params.stayDays);
    const dateFrom = format(from, 'yyyy-MM-dd');
    const dateTo = format(to, 'yyyy-MM-dd');

    const result = searchFlights({
      origin: params.origin,
      region: params.region,
      country: params.country,
      destinationQuery: params.destinationQuery,
      dateFrom,
      dateTo,
      cheapOnly: params.cheapOnly,
      maxBudget: params.maxBudget,
      connectionType: params.connectionType,
      maxStops: params.maxStops,
      travelTime: params.travelTime,
      minComfortScore: params.minComfortScore,
      travellers: params.travellers,
      cabinClass: params.cabinClass
    });

    let flights = result.flights;
    if (params.destinationIata) {
      flights = flights.filter((flight) => flight.destinationIata === params.destinationIata);
    }

    const best = flights[0];
    if (!best) continue;

    windows.push({
      dateFrom,
      dateTo,
      origin: best.origin,
      destination: best.destination,
      destinationIata: best.destinationIata,
      price: best.price,
      avg2024: best.avg2024,
      highSeasonAvg: best.highSeasonAvg,
      savingVs2024: best.savingVs2024,
      link: best.link
    });
  }

  windows.sort((a, b) => a.price - b.price || b.savingVs2024 - a.savingVs2024);

  const top = windows.slice(0, 12);
  const prices = top.map((item) => item.price);
  const stats = {
    count: top.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    avgPrice: prices.length ? Math.round(prices.reduce((acc, value) => acc + value, 0) / prices.length) : null
  };

  return { stats, windows: top };
}

const runFeatureAudit = () =>
  runFeatureAuditModule({
    searchFlights,
    connectionTypes: CONNECTION_ENUM,
    travelTimes: TRAVEL_TIME_ENUM,
    loginMaxFailures: LOGIN_MAX_FAILURES,
    loginLockMinutes: LOGIN_LOCK_MINUTES
  });

const { scanSubscriptionsOnce } = createNotificationScanService({
  withDb,
  searchFlights,
  sendMail,
  insertEmailDeliveryLog,
  getCacheClient,
  logger,
  nanoid,
  scanCacheTtlSec: SUBSCRIPTION_SCAN_CACHE_TTL_SEC,
  scanLockTtlSec: SUBSCRIPTION_SCAN_LOCK_TTL_SEC
});
const scanPriceAlertsOnce = async ({ limit = PRICE_ALERTS_WORKER_LIMIT } = {}) => runPriceAlertsWorkerOnce({ limit });

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
    getRuntimeConfigAudit,
    evaluateStartupReadiness,
    authGuard,
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
app.get('/api/security/audit/verify', authGuard, async (_req, res) => {
  const result = await verifyImmutableAudit();
  return res.json(result);
});

app.get('/api/monetization/report', authGuard, async (_req, res) => {
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

app.get('/api/analytics/funnel', authGuard, async (_req, res) => {
  const sqlFunnel = await getFunnelMetricsByChannel();
  return res.json({
    generatedAt: new Date().toISOString(),
    channels: sqlFunnel.items || []
  });
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
    nanoid,
    sendMachineError,
    captureUserPriceObservation,
    searchProviderOffers: (params) => dataProviderRegistry.searchOffers(params),
    cacheClient: getCacheClient()
  })
);
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const hashed = await hashPassword(password);

  let createdUser = null;

  await withDb(async (db) => {
    const exists = db.users.some((u) => u.email === normalizedEmail);
    if (exists) return db;

    createdUser = {
      id: nanoid(10),
      name,
      email: normalizedEmail,
      passwordHash: hashed,
      isPremium: false,
      planType: 'free',
      planStatus: 'active',
      onboardingDone: false,
      mfaEnabled: false,
      mfaSecret: null,
      mfaTempSecret: null,
      failedLoginCount: 0,
      lockUntil: null,
      authChannel: 'email_password',
      createdAt: new Date().toISOString()
    };
    db.users.push(createdUser);
    return db;
  });

  if (!createdUser) {
    await logAuthEvent({
      email: normalizedEmail,
      type: 'register_duplicate_email',
      success: false,
      req,
      detail: 'Email already registered.'
    });
    return res.status(409).json({ error: 'Email already registered.' });
  }

  const csrfToken = nanoid(24);
  const family = nanoid(16);
  const { accessToken } = await issueSessionTokens({ req, res, user: createdUser, csrfToken, family });
  await upsertUserLead({ userId: createdUser.id, email: createdUser.email, name: createdUser.name, source: 'register', channel: 'email_password' });
  await logAuthEvent({
    userId: createdUser.id,
    email: createdUser.email,
    type: 'register_success',
    success: true,
    req
  });
  return res.status(201).json({
    token: accessToken,
    session: { cookie: true, expiresInDays: 7, csrfToken },
    user: {
      id: createdUser.id,
      name: createdUser.name,
      email: createdUser.email,
      mfaEnabled: Boolean(createdUser.mfaEnabled),
      isPremium: Boolean(createdUser.isPremium),
      planType: resolveUserPlan(createdUser).planType,
      planStatus: resolveUserPlan(createdUser).planStatus,
      onboardingDone: Boolean(createdUser.onboardingDone)
    }
  });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

  const email = parsed.data.email.toLowerCase();

  let user = null;
  await withDb(async (db) => {
    user = db.users.find((u) => u.email === email) ?? null;
    return null;
  });

  if (!user) {
    await verifyPassword(parsed.data.password, LOGIN_DUMMY_PASSWORD_HASH).catch(() => false);
    await logAuthEvent({
      email,
      type: 'login_user_not_found',
      success: false,
      req
    });
    return res.status(401).json({ error: 'Wrong credentials.' });
  }

  if (userIsLocked(user)) {
    await logAuthEvent({
      userId: user.id,
      email: user.email,
      type: 'login_blocked_locked',
      success: false,
      req,
      detail: `Locked until ${user.lockUntil}`
    });
    return sendMachineError(req, res, 429, 'limit_exceeded', { reset_at: user.lockUntil });
  }

  if (!user.passwordHash) {
    await verifyPassword(parsed.data.password, LOGIN_DUMMY_PASSWORD_HASH).catch(() => false);
    await logAuthEvent({
      userId: user.id,
      email: user.email,
      type: 'login_password_not_available',
      success: false,
      req
    });
    return res.status(401).json({ error: 'Wrong credentials.' });
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    await withDb(async (db) => {
      const hit = db.users.find((u) => u.id === user.id);
      if (hit) registerFailedLogin(hit);
      return db;
    });
    await logAuthEvent({
      userId: user.id,
      email: user.email,
      type: 'login_wrong_password',
      success: false,
      req
    });
    return res.status(401).json({ error: 'Wrong credentials.' });
  }

  if (user.mfaEnabled) {
    const ticket = nanoid(32);
    const expiresAt = addDays(new Date(), 1 / (24 * 12)).toISOString();
    await withDb(async (db) => {
      db.mfaChallenges = (db.mfaChallenges || [])
        .filter((item) => new Date(item.expiresAt).getTime() > Date.now())
        .filter((item) => !(item.userId === user.id && !item.consumedAt));
      db.mfaChallenges.push({
        id: nanoid(10),
        ticket,
        userId: user.id,
        email: user.email,
        createdAt: new Date().toISOString(),
        expiresAt,
        consumedAt: null,
        attempts: 0
      });
      db.mfaChallenges = db.mfaChallenges.slice(-4000);
      return db;
    });
    await logAuthEvent({
      userId: user.id,
      email: user.email,
      type: 'login_mfa_challenge_issued',
      success: true,
      req
    });
    return res.status(202).json({ mfaRequired: true, ticket, expiresAt });
  }

  if (Number.isFinite(user.failedLoginCount) && user.failedLoginCount > 0) {
    await withDb(async (db) => {
      const hit = db.users.find((u) => u.id === user.id);
      if (hit) resetUserLoginFailures(hit);
      return db;
    });
  }

  const csrfToken = nanoid(24);
  const family = nanoid(16);
  user.authChannel = 'email_password';
  const { accessToken } = await issueSessionTokens({ req, res, user, csrfToken, family });
  await upsertUserLead({ userId: user.id, email: user.email, name: user.name, source: 'login', channel: 'email_password' });
  await logAuthEvent({
    userId: user.id,
    email: user.email,
    type: 'login_success',
    success: true,
    req
  });
  return res.json({
    token: accessToken,
    session: { cookie: true, expiresInDays: 7, csrfToken },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      mfaEnabled: Boolean(user.mfaEnabled),
      isPremium: Boolean(user.isPremium),
      planType: resolveUserPlan(user).planType,
      planStatus: resolveUserPlan(user).planStatus,
      onboardingDone: Boolean(user.onboardingDone)
    }
  });
});

app.post('/api/auth/login/mfa', authLimiter, async (req, res) => {
  const parsed = loginMfaVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid MFA verify payload.' });

  const { ticket, code } = parsed.data;
  let challenge = null;
  let user = null;
  await withDb(async (db) => {
    challenge = (db.mfaChallenges || []).find((item) => item.ticket === ticket && !item.consumedAt) || null;
    if (!challenge) return db;
    if (new Date(challenge.expiresAt).getTime() <= Date.now()) return db;
    user = db.users.find((item) => item.id === challenge.userId) || null;
    if (!user || !user.mfaEnabled || !user.mfaSecret) return db;

    const valid = speakeasy.totp.verify({
      secret: String(user.mfaSecret || ''),
      encoding: 'base32',
      token: code,
      window: 1
    });
    if (!valid) {
      challenge.attempts = (challenge.attempts || 0) + 1;
      if (challenge.attempts >= 5) {
        challenge.consumedAt = new Date().toISOString();
      }
      return db;
    }

    challenge.consumedAt = new Date().toISOString();
    return db;
  });

  if (!challenge || !user) {
    return res.status(401).json({ error: 'Invalid or expired MFA ticket.' });
  }
  if (challenge.consumedAt && (challenge.attempts || 0) >= 5) {
    await logAuthEvent({ userId: user.id, email: user.email, type: 'login_mfa_ticket_locked', success: false, req });
    return res.status(401).json({ error: 'Too many MFA attempts. Start login again.' });
  }
  const valid = challenge.consumedAt && (challenge.attempts || 0) < 5;
  if (!valid) {
    await logAuthEvent({ userId: user.id, email: user.email, type: 'login_mfa_failed', success: false, req });
    return res.status(401).json({ error: 'Invalid MFA code.' });
  }

  if (Number.isFinite(user.failedLoginCount) && user.failedLoginCount > 0) {
    await withDb(async (db) => {
      const hit = db.users.find((u) => u.id === user.id);
      if (hit) resetUserLoginFailures(hit);
      return db;
    });
  }

  const csrfToken = nanoid(24);
  const family = nanoid(16);
  user.authChannel = 'email_mfa';
  const { accessToken } = await issueSessionTokens({ req, res, user, csrfToken, family });
  await upsertUserLead({ userId: user.id, email: user.email, name: user.name, source: 'login_mfa', channel: 'email_mfa' });
  await logAuthEvent({ userId: user.id, email: user.email, type: 'login_success_mfa', success: true, req });
  return res.json({
    token: accessToken,
    session: { cookie: true, expiresInDays: 7, csrfToken },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      mfaEnabled: Boolean(user.mfaEnabled),
      isPremium: Boolean(user.isPremium),
      planType: resolveUserPlan(user).planType,
      planStatus: resolveUserPlan(user).planStatus,
      onboardingDone: Boolean(user.onboardingDone)
    }
  });
});

app.post('/api/auth/password-reset/request', authLimiter, async (req, res) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'validation_failed', message: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

  const normalizedEmail = parsed.data.email.toLowerCase();
  let user = null;
  await withDb(async (db) => {
    user = db.users.find((item) => item.email === normalizedEmail) || null;
    db.passwordResetTokens = (db.passwordResetTokens || []).filter((entry) => !entry.usedAt && new Date(entry.expiresAt).getTime() > Date.now());
    return db;
  });

  if (user) {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashPasswordResetToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await withDb(async (db) => {
      db.passwordResetTokens = db.passwordResetTokens || [];
      db.passwordResetTokens.push({
        id: nanoid(12),
        userId: user.id,
        tokenHash,
        expiresAt,
        usedAt: null,
        createdAt: new Date().toISOString()
      });
      db.passwordResetTokens = db.passwordResetTokens.slice(-5000);
      return db;
    });

    sendMail({
      to: user.email,
      subject: 'Password reset request',
      text: `Use this secure link to reset your password: ${buildPasswordResetUrl(rawToken)}`,
      html: `<p>Use this secure link to reset your password:</p><p><a href="${buildPasswordResetUrl(rawToken)}">${buildPasswordResetUrl(rawToken)}</a></p>`
    }).catch(() => {});

    await logAuthEvent({
      userId: user.id,
      email: user.email,
      type: 'password_reset_requested',
      success: true,
      req
    });
  }

  return res.json({ ok: true });
});

app.post('/api/auth/password-reset/confirm', authLimiter, async (req, res) => {
  const parsed = passwordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'validation_failed', message: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

  const tokenHash = hashPasswordResetToken(parsed.data.token);
  const snapshot = await readDb();
  const tokenRow = (snapshot.passwordResetTokens || []).find((entry) => entry.tokenHash === tokenHash);
  const tokenIsValid = Boolean(tokenRow && !tokenRow.usedAt && new Date(tokenRow.expiresAt).getTime() > Date.now());
  if (!tokenIsValid) {
    return res.status(400).json({ error: 'invalid_or_expired_token', message: 'Invalid or expired reset token.' });
  }
  const user = snapshot.users.find((entry) => entry.id === tokenRow.userId);
  if (!user) return res.status(400).json({ error: 'invalid_or_expired_token', message: 'Invalid or expired reset token.' });

  const hashed = await hashPassword(parsed.data.password);
  await withDb(async (db) => {
    const nowIso = new Date().toISOString();
    const dbUser = db.users.find((entry) => entry.id === user.id);
    if (dbUser) {
      dbUser.passwordHash = hashed;
      resetUserLoginFailures(dbUser);
    }
    db.passwordResetTokens = (db.passwordResetTokens || []).map((entry) => {
      if (entry.userId !== user.id) return entry;
      return { ...entry, usedAt: entry.usedAt || nowIso };
    });
    return db;
  });

  await logAuthEvent({
    userId: user.id,
    email: user.email,
    type: 'password_reset_confirmed',
    success: true,
    req
  });

  return res.json({ ok: true });
});

function firstCsvValue(value) {
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .find(Boolean);
}

function redirectToFrontend(res, params = {}) {
  const url = new URL(FRONTEND_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    url.searchParams.set(k, String(v));
  }
  return res.redirect(url.toString());
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function enrichDecisionWithAi({ aiProvider = 'none', requestPayload, decisionResult }) {
  const provider = String(aiProvider || 'none').toLowerCase();
  if (provider === 'none') return { provider: 'none', enhanced: false };

  const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const claudeKey = String(process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim();

  const selected =
    provider === 'chatgpt'
      ? 'chatgpt'
      : provider === 'claude'
      ? 'claude'
      : openaiKey
      ? 'chatgpt'
      : claudeKey
      ? 'claude'
      : 'none';

  if (selected === 'none') return { provider: 'none', enhanced: false };

  const compact = (decisionResult.recommendations || []).map((item) => ({
    destination: item.destination,
    iata: item.destinationIata,
    score: item.travelScore,
    total: item.costBreakdown?.total,
    climate: item.climateInPeriod,
    crowding: item.crowding
  }));

  const systemPrompt =
    'You are a travel decision co-pilot. Return strict JSON only: {"items":[{"destinationIata":"XXX","whyNow":"...","riskNote":"..."}]}';
  const userPrompt = JSON.stringify({
    request: requestPayload,
    recommendations: compact
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    let aiJson = null;
    try {
      if (selected === 'chatgpt' && openaiKey) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ]
          }),
          signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        const content = payload?.choices?.[0]?.message?.content || '';
        aiJson = extractJsonObject(content);
      } else if (selected === 'claude' && claudeKey) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': claudeKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
            max_tokens: 400,
            temperature: 0.2,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
          }),
          signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        const content = Array.isArray(payload?.content) ? payload.content.map((x) => x?.text || '').join('\n') : '';
        aiJson = extractJsonObject(content);
      }
    } finally {
      clearTimeout(timer);
    }
    const items = Array.isArray(aiJson?.items) ? aiJson.items : [];
    if (!items.length) return { provider: selected, enhanced: false };

    const byIata = new Map(items.map((x) => [String(x.destinationIata || '').toUpperCase(), x]));
    for (const rec of decisionResult.recommendations || []) {
      const aiItem = byIata.get(String(rec.destinationIata || '').toUpperCase());
      if (!aiItem) continue;
      rec.aiWhyNow = String(aiItem.whyNow || '').slice(0, 220);
      rec.aiRiskNote = String(aiItem.riskNote || '').slice(0, 180);
    }
    return { provider: selected, enhanced: true };
  } catch {
    return { provider: selected, enhanced: false };
  }
}

function parseIntentHeuristics(prompt, packageCount) {
  const raw = String(prompt || '').trim();
  const text = raw.toLowerCase();
  const preferences = {
    mood: 'relax',
    climatePreference: 'indifferent',
    pace: 'normal',
    avoidOvertourism: false,
    packageCount: packageCount === 4 ? 4 : 3
  };

  const budgetMatch = raw.match(/(\d{2,5})\s*(€|eur|euro)/i) || raw.match(/budget[^0-9]*(\d{2,5})/i);
  if (budgetMatch) preferences.budgetMax = Number(budgetMatch[1]);

  const daysMatch = raw.match(/(\d{1,2})\s*(giorni|giorno|days|day|notti|notte|nights|night)/i);
  if (daysMatch) preferences.tripLengthDays = Math.max(2, Math.min(21, Number(daysMatch[1])));

  const iataMatch = raw.match(/\b[A-Z]{3}\b/g);
  if (Array.isArray(iataMatch) && iataMatch.length > 0) {
    const known = new Set((ORIGINS || []).map((o) => String(o.code || '').toUpperCase()));
    const picked = iataMatch.map((x) => x.toUpperCase()).find((x) => known.has(x));
    if (picked) preferences.origin = picked;
  }

  if (text.includes('party') || text.includes('vita notturna') || text.includes('nightlife')) preferences.mood = 'party';
  else if (text.includes('natura') || text.includes('trek') || text.includes('hiking')) preferences.mood = 'natura';
  else if (text.includes('cultura') || text.includes('musei') || text.includes('museum')) preferences.mood = 'cultura';
  else if (text.includes('avventura') || text.includes('adventure')) preferences.mood = 'avventura';

  if (text.includes('caldo') || text.includes('warm') || text.includes('hot')) preferences.climatePreference = 'warm';
  else if (text.includes('freddo') || text.includes('cold')) preferences.climatePreference = 'cold';
  else if (text.includes('temperato') || text.includes('mild')) preferences.climatePreference = 'mild';

  if (text.includes('slow') || text.includes('rilassato') || text.includes('lento')) preferences.pace = 'slow';
  else if (text.includes('fast') || text.includes('veloce') || text.includes('ritmo alto')) preferences.pace = 'fast';

  if (text.includes('overtourism') || text.includes('no affollamento') || text.includes('poco affollat')) {
    preferences.avoidOvertourism = true;
  }

  if (text.includes('europa') || text.includes('europe')) preferences.region = 'eu';
  else if (text.includes('asia')) preferences.region = 'asia';
  else if (text.includes('america')) preferences.region = 'america';
  else if (text.includes('oceania')) preferences.region = 'oceania';

  const summaryParts = [];
  if (preferences.budgetMax) summaryParts.push(`budget ${preferences.budgetMax} EUR`);
  if (preferences.tripLengthDays) summaryParts.push(`${preferences.tripLengthDays} giorni`);
  summaryParts.push(`mood ${preferences.mood}`);
  summaryParts.push(`clima ${preferences.climatePreference}`);
  if (preferences.origin) summaryParts.push(`partenza ${preferences.origin}`);
  summaryParts.push(`${preferences.packageCount} pacchetti`);
  if (preferences.avoidOvertourism) summaryParts.push('filtro no overtourism');

  return {
    provider: 'heuristic',
    enhanced: false,
    preferences,
    summary: `Preferenze rilevate: ${summaryParts.join(', ')}.`
  };
}

async function parseIntentWithAi({ prompt, aiProvider = 'none', packageCount = 3 }) {
  const heuristic = parseIntentHeuristics(prompt, packageCount);
  const provider = String(aiProvider || 'none').toLowerCase();
  if (provider === 'none') return heuristic;

  const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const claudeKey = String(process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
  const selected =
    provider === 'chatgpt'
      ? 'chatgpt'
      : provider === 'claude'
      ? 'claude'
      : openaiKey
      ? 'chatgpt'
      : claudeKey
      ? 'claude'
      : 'none';
  if (selected === 'none') return heuristic;

  const systemPrompt =
    'Extract travel intent as strict JSON only: {"preferences":{"origin":"IATA?","budgetMax":number?,"tripLengthDays":number?,"mood":"relax|natura|party|cultura|avventura","climatePreference":"warm|mild|cold|indifferent","pace":"slow|normal|fast","avoidOvertourism":boolean,"region":"all|eu|asia|america|oceania","packageCount":3|4},"summary":"..."}';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    let aiJson = null;
    try {
      if (selected === 'chatgpt' && openaiKey) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: String(prompt || '') }
            ]
          }),
          signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        aiJson = extractJsonObject(payload?.choices?.[0]?.message?.content || '');
      } else if (selected === 'claude' && claudeKey) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': claudeKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
            max_tokens: 300,
            temperature: 0.1,
            system: systemPrompt,
            messages: [{ role: 'user', content: String(prompt || '') }]
          }),
          signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        const content = Array.isArray(payload?.content) ? payload.content.map((x) => x?.text || '').join('\n') : '';
        aiJson = extractJsonObject(content);
      }
    } finally {
      clearTimeout(timer);
    }
    const prefs = aiJson?.preferences || {};
    const merged = {
      ...heuristic.preferences,
      ...prefs,
      packageCount: prefs?.packageCount === 4 ? 4 : heuristic.preferences.packageCount
    };
    return {
      provider: selected,
      enhanced: true,
      preferences: merged,
      summary: String(aiJson?.summary || heuristic.summary).slice(0, 320)
    };
  } catch {
    return heuristic;
  }
}

app.get('/api/auth/oauth/google/start', authLimiter, async (_req, res) => {
  const clientId = firstCsvValue(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_IDS);
  if (!clientId) return res.status(503).json({ error: 'Google OAuth not configured.' });
  const oauth = await createOAuthSession('google', GOOGLE_OAUTH_REDIRECT_URI);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', oauth.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', oauth.state);
  url.searchParams.set('nonce', oauth.nonce);
  url.searchParams.set('code_challenge', oauth.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  return res.redirect(url.toString());
});

app.get('/api/auth/oauth/google/callback', authLimiter, async (req, res) => {
  const state = String(req.query.state || '');
  const code = String(req.query.code || '');
  if (!state || !code) return redirectToFrontend(res, { oauth: 'error', reason: 'google_missing_code' });

  const oauthSession = await consumeOAuthSessionByState({ provider: 'google', state });
  if (!oauthSession) return redirectToFrontend(res, { oauth: 'error', reason: 'google_invalid_state' });

  try {
    const tokenPayload = await exchangeGoogleCodeForTokens({
      code,
      codeVerifier: oauthSession.codeVerifier,
      redirectUri: oauthSession.redirectUri || GOOGLE_OAUTH_REDIRECT_URI
    });
    const profile = await verifyGoogleIdToken(tokenPayload.id_token);
    if (!profile.nonce || profile.nonce !== oauthSession.nonce) {
      return redirectToFrontend(res, { oauth: 'error', reason: 'google_nonce_mismatch' });
    }
    await completeOAuthLogin({ req, res, profile });
    return redirectToFrontend(res, { oauth: 'success', provider: 'google' });
  } catch (error) {
    return redirectToFrontend(res, { oauth: 'error', reason: 'google_exchange_failed' });
  }
});

app.get('/api/auth/oauth/apple/start', authLimiter, async (_req, res) => {
  const clientId = firstCsvValue(process.env.APPLE_CLIENT_ID || process.env.APPLE_CLIENT_IDS);
  if (!clientId) return res.status(503).json({ error: 'Apple OAuth not configured.' });
  const oauth = await createOAuthSession('apple', APPLE_OAUTH_REDIRECT_URI);
  const url = new URL('https://appleid.apple.com/auth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', oauth.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', 'name email');
  url.searchParams.set('state', oauth.state);
  url.searchParams.set('nonce', oauth.nonce);
  url.searchParams.set('code_challenge', oauth.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return res.redirect(url.toString());
});

app.get('/api/auth/oauth/facebook/start', authLimiter, async (_req, res) => {
  const clientId = firstCsvValue(process.env.FACEBOOK_CLIENT_ID || process.env.FACEBOOK_CLIENT_IDS);
  if (!clientId) return res.status(503).json({ error: 'Facebook OAuth not configured.' });
  const oauth = await createOAuthSession('facebook', FACEBOOK_OAUTH_REDIRECT_URI);
  const url = new URL('https://www.facebook.com/v20.0/dialog/oauth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', oauth.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', oauth.state);
  url.searchParams.set('scope', 'email,public_profile');
  return res.redirect(url.toString());
});

async function handleAppleCallback(req, res) {
  const state = String(req.body?.state || req.query?.state || '');
  const code = String(req.body?.code || req.query?.code || '');
  if (!state || !code) return redirectToFrontend(res, { oauth: 'error', reason: 'apple_missing_code' });

  const oauthSession = await consumeOAuthSessionByState({ provider: 'apple', state });
  if (!oauthSession) return redirectToFrontend(res, { oauth: 'error', reason: 'apple_invalid_state' });

  try {
    const tokenPayload = await exchangeAppleCodeForTokens({
      code,
      codeVerifier: oauthSession.codeVerifier,
      redirectUri: oauthSession.redirectUri || APPLE_OAUTH_REDIRECT_URI
    });
    const profile = await verifyAppleIdToken(tokenPayload.id_token);
    if (!profile.nonce || profile.nonce !== oauthSession.nonce) {
      return redirectToFrontend(res, { oauth: 'error', reason: 'apple_nonce_mismatch' });
    }
    await completeOAuthLogin({ req, res, profile });
    return redirectToFrontend(res, { oauth: 'success', provider: 'apple' });
  } catch {
    return redirectToFrontend(res, { oauth: 'error', reason: 'apple_exchange_failed' });
  }
}

app.get('/api/auth/oauth/apple/callback', authLimiter, handleAppleCallback);
app.post('/api/auth/oauth/apple/callback', authLimiter, handleAppleCallback);

app.get('/api/auth/oauth/facebook/callback', authLimiter, async (req, res) => {
  const state = String(req.query.state || '');
  const code = String(req.query.code || '');
  if (!state || !code) return redirectToFrontend(res, { oauth: 'error', reason: 'facebook_missing_code' });

  const oauthSession = await consumeOAuthSessionByState({ provider: 'facebook', state });
  if (!oauthSession) return redirectToFrontend(res, { oauth: 'error', reason: 'facebook_invalid_state' });

  try {
    const profile = await exchangeFacebookCodeForProfile({
      code,
      redirectUri: oauthSession.redirectUri || FACEBOOK_OAUTH_REDIRECT_URI
    });
    await completeOAuthLogin({ req, res, profile });
    return redirectToFrontend(res, { oauth: 'success', provider: 'facebook' });
  } catch {
    return redirectToFrontend(res, { oauth: 'error', reason: 'facebook_exchange_failed' });
  }
});

app.post('/api/auth/oauth/session', authLimiter, async (req, res) => {
  const parsed = oauthSessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid oauth session payload.' });
  const redirectUri =
    parsed.data.provider === 'google'
      ? GOOGLE_OAUTH_REDIRECT_URI
      : parsed.data.provider === 'apple'
      ? APPLE_OAUTH_REDIRECT_URI
      : FACEBOOK_OAUTH_REDIRECT_URI;
  const session = await createOAuthSession(parsed.data.provider, redirectUri);
  return res.json({
    oauthSessionId: session.id,
    provider: session.provider,
    state: session.state,
    nonce: session.nonce,
    expiresAt: session.expiresAt
  });
});

app.post('/api/auth/oauth/google', authLimiter, async (req, res) => {
  const parsed = oauthLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid OAuth payload.' });

  const oauthSession = await consumeOAuthSessionById({ id: parsed.data.oauthSessionId, provider: 'google', state: parsed.data.state });
  if (!oauthSession) return res.status(401).json({ error: 'Invalid or expired OAuth session.' });

  let profile = null;
  try {
    profile = await verifyGoogleIdToken(parsed.data.idToken);
  } catch (error) {
    return res.status(401).json({ error: error?.message || 'Google token validation failed.' });
  }
  if (!profile.nonce || profile.nonce !== oauthSession.nonce) {
    return res.status(401).json({ error: 'Google nonce mismatch.' });
  }
  const payload = await completeOAuthLogin({ req, res, profile });
  return res.json(payload);
});

app.post('/api/auth/oauth/apple', authLimiter, async (req, res) => {
  const parsed = oauthLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid OAuth payload.' });

  const oauthSession = await consumeOAuthSessionById({ id: parsed.data.oauthSessionId, provider: 'apple', state: parsed.data.state });
  if (!oauthSession) return res.status(401).json({ error: 'Invalid or expired OAuth session.' });

  let profile = null;
  try {
    profile = await verifyAppleIdToken(parsed.data.idToken);
  } catch (error) {
    return res.status(401).json({ error: error?.message || 'Apple token validation failed.' });
  }
  if (!profile.nonce || profile.nonce !== oauthSession.nonce) {
    return res.status(401).json({ error: 'Apple nonce mismatch.' });
  }
  const payload = await completeOAuthLogin({ req, res, profile });
  return res.json(payload);
});

app.use(
  '/api',
  buildAuthSessionRouter({
    authGuard,
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
    mfaCodeSchema
  })
);
app.get('/api/outbound/resolve', async (req, res) => {
  const parsed = outboundResolveSchema.safeParse(req.query);
  if (!parsed.success) {
    return sendMachineError(req, res, 400, 'invalid_payload', {
      message: parsed.error.issues[0]?.message ?? 'Controlla i dati inseriti e riprova.'
    });
  }

  const payload = parsed.data;
  let resolvedUrl;
  try {
    resolvedUrl = resolveOutboundPartnerUrl(payload);
  } catch (error) {
    return sendMachineError(req, res, 400, 'invalid_payload', { message: error?.message || 'Outbound URL non valida.' });
  }

  const clickId = nanoid(12);
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + OUTBOUND_CLICK_TTL_SECONDS * 1000).toISOString();
  const clickToken = createOutboundClickToken({ clickId, targetUrl: resolvedUrl, expiresAt });
  const auth = optionalAuth(req);
  await withDb(async (db) => {
    db.outboundRedirects = db.outboundRedirects || [];
    db.outboundRedirects.push({
      id: clickId,
      clickId,
      issuedAt,
      expiresAt,
      clickToken,
      userId: auth?.sub || null,
      partner: payload.partner,
      url: resolvedUrl,
      surface: payload.surface,
      origin: payload.origin,
      destinationIata: payload.destinationIata,
      destination: payload.destination || payload.destinationIata,
      stopCount: payload.stopCount,
      comfortScore: payload.comfortScore,
      connectionType: payload.connectionType,
      travelTime: payload.travelTime,
      utmSource: payload.utmSource,
      utmMedium: payload.utmMedium,
      utmCampaign: payload.utmCampaign
    });
    db.outboundRedirects = db.outboundRedirects
      .filter((entry) => new Date(entry.expiresAt).getTime() > Date.now())
      .slice(-10000);
    return db;
  });

  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, `/go/${clickId}`);
});

app.get('/go/:clickId', async (req, res) => {
  const clickId = String(req.params.clickId || '').trim();
  const auth = optionalAuth(req);
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(clickId)) {
    return sendMachineError(req, res, 400, 'invalid_payload', { message: 'Link non valido.' });
  }

  let redirectEntry = null;
  await withDb(async (db) => {
    db.outboundRedirects = (db.outboundRedirects || []).filter((entry) => new Date(entry.expiresAt).getTime() > Date.now());
    redirectEntry = db.outboundRedirects.find((entry) => entry.clickId === clickId) || null;
    if (!redirectEntry) return db;
    db.outboundRedirects = db.outboundRedirects.filter((entry) => entry.clickId !== clickId);
    db.outboundClicks.push({
      id: nanoid(10),
      at: new Date().toISOString(),
      clickId: redirectEntry.clickId,
      userId: redirectEntry.userId || auth?.sub || null,
      partner: redirectEntry.partner,
      url: redirectEntry.url,
      surface: redirectEntry.surface,
      origin: redirectEntry.origin,
      destinationIata: redirectEntry.destinationIata,
      destination: redirectEntry.destination,
      stopCount: redirectEntry.stopCount,
      comfortScore: redirectEntry.comfortScore,
      connectionType: redirectEntry.connectionType,
      travelTime: redirectEntry.travelTime,
      utmSource: redirectEntry.utmSource,
      utmMedium: redirectEntry.utmMedium,
      utmCampaign: redirectEntry.utmCampaign
    });
    db.outboundClicks = db.outboundClicks.slice(-5000);
    return db;
  });

  if (!redirectEntry) {
    return sendMachineError(req, res, 400, 'request_failed', { message: 'Il link è scaduto o non più valido.' });
  }
  if (!verifyOutboundClickToken({ clickId: redirectEntry.clickId, targetUrl: redirectEntry.url, expiresAt: redirectEntry.expiresAt, clickToken: redirectEntry.clickToken })) {
    return sendMachineError(req, res, 400, 'request_failed', { message: 'Impossibile verificare il link di uscita.' });
  }
  if (new Date(redirectEntry.expiresAt).getTime() <= Date.now()) {
    return sendMachineError(req, res, 400, 'request_failed', { message: 'Il link è scaduto. Riprova dalla ricerca.' });
  }
  try {
    ensureAllowedOutboundUrl(redirectEntry.url);
  } catch {
    return sendMachineError(req, res, 400, 'request_failed', { message: 'Destinazione partner non consentita.' });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, redirectEntry.url);
});

app.post('/api/outbound/click', async (req, res) => {
  const parsed = outboundClickSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid outbound payload.' });

  const auth = optionalAuth(req);
  const payload = parsed.data;

  await withDb(async (db) => {
    db.outboundClicks.push({
      id: nanoid(10),
      at: new Date().toISOString(),
      userId: auth?.sub || null,
      ...payload
    });
    db.outboundClicks = db.outboundClicks.slice(-5000);
    return db;
  });

  return res.status(201).json({ ok: true });
});

app.get('/api/outbound/report', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
  let report = null;
  await withDb(async (db) => {
    report = buildOutboundReport(db, 30);
    return null;
  });
  return res.json(report);
});

app.get('/api/outbound/report.csv', authGuard, requireApiScope('export'), quotaGuard({ counter: 'export', amount: 1 }), async (req, res) => {
  let report = null;
  await withDb(async (db) => {
    report = buildOutboundReport(db, 30);
    return null;
  });
  const csv = outboundReportToCsv(report);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="outbound-report-${format(new Date(), 'yyyyMMdd-HHmm')}.csv"`);
  return res.status(200).send(csv);
});

app.post('/api/insights/destination', authGuard, csrfGuard, premiumGuard, requireApiScope('search'), quotaGuard({ counter: 'decision', amount: 1 }), async (req, res) => {
  const parsed = destinationInsightSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

  const result = buildDestinationInsights(parsed.data);
  return res.json(result);
});

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
app.use('/api/keys',    buildApiKeysRouter({ authGuard, csrfGuard }));
app.use('/api/billing', buildBillingRouter({ authGuard, csrfGuard }));
app.use('/api/usage',   buildUsageRouter({ authGuard }));
app.use('/', buildDealEngineRouter());
app.use('/api/discovery', buildDiscoveryRouter({ authGuard, csrfGuard, quotaGuard, requireApiScope }));
app.use('/api/opportunities', buildOpportunitiesRouter({ authGuard, csrfGuard, requireApiScope, quotaGuard, withDb, optionalAuth }));

app.use(errorHandler);

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

const httpServer = app.listen(PORT, () => {
  logger.info({ port: PORT, version: BUILD_VERSION }, 'server_started');
});
const cronTasks = [];
const cronRunningJobs = new Set();
const CRON_ALLOW_OVERLAP_JOBS = new Set(
  String(process.env.CRON_ALLOW_OVERLAP_JOBS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

function scheduleCronJob(name, expression, jobFn, options = {}) {
  const task = cron.schedule(
    expression,
    async () => {
      const overlapAllowed = CRON_ALLOW_OVERLAP_JOBS.has(name);
      if (!overlapAllowed && cronRunningJobs.has(name)) {
        logger.warn(
          {
            job: name,
            schedule: expression,
            timezone: options?.timezone || 'system'
          },
          'cron_job_skipped_overlap'
        );
        return;
      }
      if (!overlapAllowed) cronRunningJobs.add(name);
      const startedAt = Date.now();
      try {
        let attempt = 0;
        while (true) {
          try {
            await jobFn();
            if (attempt > 0) {
              logger.info({ job: name, retries: attempt }, 'cron_job_recovered_after_retry');
            }
            break;
          } catch (error) {
            if (attempt >= CRON_RETRY_ATTEMPTS) throw error;
            attempt += 1;
            logger.warn({ job: name, attempt, retryDelayMs: CRON_RETRY_DELAY_MS, err: error }, 'cron_job_retry_scheduled');
            await new Promise((resolveDelay) => setTimeout(resolveDelay, CRON_RETRY_DELAY_MS));
          }
        }
        logger.info(
          {
            job: name,
            schedule: expression,
            timezone: options?.timezone || 'system',
            durationMs: Date.now() - startedAt
          },
          'cron_job_completed'
        );
      } catch (error) {
        logger.error(
          {
            job: name,
            schedule: expression,
            timezone: options?.timezone || 'system',
            durationMs: Date.now() - startedAt,
            err: error
          },
          'cron_job_failed'
        );
      } finally {
        if (!overlapAllowed) cronRunningJobs.delete(name);
      }
    },
    options
  );
  cronTasks.push({ name, task });
  return task;
}

async function runStartupTask(name, taskFn) {
  const startedAt = Date.now();
  try {
    await taskFn();
    logger.info({ task: name, durationMs: Date.now() - startedAt }, 'startup_task_completed');
  } catch (error) {
    logger.error({ task: name, durationMs: Date.now() - startedAt, err: error }, 'startup_task_failed');
  }
}

async function bootstrapOpportunitySeedIfEmpty() {
  const status = await getDataFoundationStatus();
  const priceObservations = Number(status?.totals?.priceObservations || 0);
  if (priceObservations > 0) {
    logger.info({ priceObservations }, 'opportunity_seed_bootstrap_skipped_existing_data');
    return { skipped: true, reason: 'existing_data', priceObservations };
  }

  const defaultSeedFile = resolve(process.cwd(), 'data', 'price-observations.template.csv');
  if (!existsSync(defaultSeedFile)) {
    logger.warn({ defaultSeedFile }, 'opportunity_seed_bootstrap_skipped_missing_seed_file');
    return { skipped: true, reason: 'missing_seed_file' };
  }

  const seeded = await runSeedImportOnce({ filePath: defaultSeedFile, dryRun: false });
  await runNightlyRouteBaselineJob({ reason: 'opportunity_seed_bootstrap' });
  await runOpportunityPipelineOnce();
  logger.info({ seeded }, 'opportunity_seed_bootstrap_completed');
  return { skipped: false, seeded };
}

scheduleCronJob('notifications_scan', CRON_SCHEDULE, () => scanSubscriptionsOnce());
scheduleCronJob('ai_pricing', AI_PRICING_CRON, () => monitorAndUpdateSubscriptionPricing({ reason: 'scheduled' }), { timezone: AI_PRICING_CRON_TIMEZONE });
scheduleCronJob('free_precompute', FREE_PRECOMPUTE_CRON, () => runNightlyFreePrecompute({ reason: 'scheduled' }), { timezone: FREE_JOBS_TIMEZONE });
scheduleCronJob('free_alert_worker', FREE_ALERT_WORKER_CRON, () => runFreeAlertWorkerOnce(), { timezone: FREE_JOBS_TIMEZONE });
scheduleCronJob('route_baseline', DEAL_BASELINE_CRON, () => runNightlyRouteBaselineJob({ reason: 'scheduled' }), { timezone: DEAL_BASELINE_CRON_TIMEZONE });
scheduleCronJob('baseline_recompute_worker', DEAL_BASELINE_CRON, () => runBaselineRecomputeOnce(), { timezone: DEAL_BASELINE_CRON_TIMEZONE });
scheduleCronJob('discovery_alert_worker', DISCOVERY_ALERT_WORKER_CRON, () => runDiscoveryAlertWorkerOnce(), { timezone: DISCOVERY_ALERT_WORKER_TIMEZONE });
scheduleCronJob('price_ingestion_worker', PRICE_INGEST_WORKER_CRON, () => runPriceIngestionWorkerOnce({ maxJobs: 500 }), { timezone: PRICE_INGEST_WORKER_TIMEZONE });
scheduleCronJob('opportunity_pipeline_worker', OPPORTUNITY_PIPELINE_CRON, () => runOpportunityPipelineOnce(), { timezone: OPPORTUNITY_PIPELINE_TIMEZONE });
scheduleCronJob('ingestion_jobs_maintenance', INGESTION_JOBS_MAINTENANCE_CRON, () => runIngestionJobsMaintenance({ force: true }), {
  timezone: INGESTION_JOBS_MAINTENANCE_TIMEZONE
});
if (ROUTE_PRICE_STATS_ENABLED) {
  scheduleCronJob('route_price_stats_worker', ROUTE_PRICE_STATS_CRON, () => runRoutePriceStatsWorkerOnce(), { timezone: ROUTE_PRICE_STATS_TIMEZONE });
}
if (DETECTED_DEALS_ENABLED) {
  scheduleCronJob('detected_deals_worker', DETECTED_DEALS_CRON, () => runDetectedDealsWorkerOnce(), { timezone: DETECTED_DEALS_TIMEZONE });
}
if (DEALS_CONTENT_ENABLED) {
  scheduleCronJob('deals_content_worker', DEALS_CONTENT_CRON, () => runDealsContentWorkerOnce(), { timezone: DEALS_CONTENT_TIMEZONE });
}
if (PRICE_ALERTS_ENABLED) {
  scheduleCronJob('price_alerts_worker', PRICE_ALERTS_CRON, () => runPriceAlertsWorkerOnce({ limit: PRICE_ALERTS_WORKER_LIMIT }), {
    timezone: PRICE_ALERTS_TIMEZONE
  });
}
scheduleCronJob('radar_match_precompute_worker', RADAR_MATCH_PRECOMPUTE_CRON, () => runRadarMatchPrecomputeOnce(), { timezone: RADAR_MATCH_PRECOMPUTE_TIMEZONE });
if (FLIGHT_SCAN_ENABLED) {
  scheduleCronJob('flight_scan_scheduler', FLIGHT_SCAN_SCHEDULER_CRON, () => runFlightScanSchedulerOnce({ enabled: true }), { timezone: FLIGHT_SCAN_TIMEZONE });
  scheduleCronJob('flight_scan_worker', FLIGHT_SCAN_WORKER_CRON, () => runFlightScanWorkerOnce({ enabled: true }), { timezone: FLIGHT_SCAN_TIMEZONE });
}
if (PROVIDER_COLLECTION_EFFECTIVE_ENABLED) {
  scheduleCronJob('provider_collection_worker', PROVIDER_COLLECTION_CRON, () => runProviderCollectionOnce(), { timezone: PROVIDER_COLLECTION_TIMEZONE });
}

if (RUN_STARTUP_TASKS) {
  runStartupTask('ai_pricing_startup_check', () => monitorAndUpdateSubscriptionPricing({ reason: 'startup' }));
  runStartupTask('free_precompute_startup', () => runNightlyFreePrecompute({ reason: 'startup' }));
  runStartupTask('route_baseline_startup', () => runNightlyRouteBaselineJob({ reason: 'startup' }));
  runStartupTask('baseline_recompute_startup', () => runBaselineRecomputeOnce());
  runStartupTask('discovery_alert_worker_startup', () => runDiscoveryAlertWorkerOnce({ limit: 200 }));
  runStartupTask('price_ingestion_worker_startup', () => runPriceIngestionWorkerOnce({ maxJobs: 500 }));
  runStartupTask('ingestion_jobs_maintenance_startup', () => runIngestionJobsMaintenance({ force: true }));
  runStartupTask('opportunity_seed_bootstrap_startup', () => bootstrapOpportunitySeedIfEmpty());
  runStartupTask('opportunity_pipeline_startup', () => runOpportunityPipelineOnce());
  if (ROUTE_PRICE_STATS_ENABLED) {
    runStartupTask('route_price_stats_startup', () => runRoutePriceStatsWorkerOnce());
  }
  if (DETECTED_DEALS_ENABLED) {
    runStartupTask('detected_deals_startup', () => runDetectedDealsWorkerOnce());
  }
  if (DEALS_CONTENT_ENABLED && DEALS_CONTENT_RUN_ON_STARTUP) {
    runStartupTask('deals_content_startup', () => runDealsContentWorkerOnce());
  }
  if (PRICE_ALERTS_ENABLED) {
    runStartupTask('price_alerts_startup', () => runPriceAlertsWorkerOnce({ limit: PRICE_ALERTS_WORKER_LIMIT }));
  }
  runStartupTask('radar_match_precompute_startup', () => runRadarMatchPrecomputeOnce());
  if (FLIGHT_SCAN_ENABLED) {
    runStartupTask('flight_scan_scheduler_startup', () => runFlightScanSchedulerOnce({ enabled: true }));
    runStartupTask('flight_scan_worker_startup', () => runFlightScanWorkerOnce({ enabled: true }));
  }
  if (PROVIDER_COLLECTION_EFFECTIVE_ENABLED) {
    runStartupTask('provider_collection_startup', () => runProviderCollectionOnce());
  }
  if (BOOTSTRAP_SEED_IMPORT_FILE) {
    runStartupTask('seed_import_startup', () => runSeedImportOnce({ filePath: BOOTSTRAP_SEED_IMPORT_FILE, dryRun: BOOTSTRAP_SEED_IMPORT_DRY_RUN }));
  }
} else {
  logger.info({ runStartupTasks: false }, 'startup_tasks_skipped_disabled');
}

let shuttingDown = false;
async function gracefulShutdown(signal, { exitCode = 0 } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn({ signal }, 'shutdown_started');

  for (const entry of cronTasks) {
    try {
      entry.task.stop();
    } catch (error) {
      logger.warn({ err: error, job: entry.name }, 'cron_job_stop_failed');
    }
  }

  await Promise.race([
    new Promise((resolveClose) => {
      httpServer.close((error) => {
        if (error) logger.error({ err: error }, 'http_server_close_failed');
        else logger.info({}, 'http_server_closed');
        resolveClose();
      });
    }),
    new Promise((resolveTimeout) => {
      setTimeout(() => {
        logger.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'http_server_close_timeout');
        resolveTimeout();
      }, SHUTDOWN_TIMEOUT_MS);
    })
  ]);

  if (pgPool) {
    try {
      await pgPool.end();
      logger.info({}, 'pg_pool_closed');
    } catch (error) {
      logger.error({ err: error }, 'pg_pool_close_failed');
    }
  }
  try {
    await closeCacheClient();
  } catch (error) {
    logger.warn({ err: error }, 'cache_client_close_failed');
  }

  logger.info({ signal }, 'shutdown_completed');
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').catch((error) => {
    logger.fatal({ err: error }, 'shutdown_failed');
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch((error) => {
    logger.fatal({ err: error }, 'shutdown_failed');
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled_rejection');
  if (process.env.NODE_ENV === 'production') {
    gracefulShutdown('UNHANDLED_REJECTION', { exitCode: 1 }).catch((error) => {
      logger.fatal({ err: error }, 'shutdown_failed_after_unhandled_rejection');
      process.exit(1);
    });
  }
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught_exception');
  gracefulShutdown('UNCAUGHT_EXCEPTION', { exitCode: 1 }).catch((shutdownError) => {
    logger.fatal({ err: shutdownError }, 'shutdown_failed_after_uncaught_exception');
    process.exit(1);
  });
});










