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
import { z } from 'zod';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { hashPassword, signAccessToken, signRefreshToken, verifyAccessToken, verifyPassword, verifyRefreshToken } from './lib/auth.js';
import { buildBookingLink, decideTrips, getDestinationSuggestions, searchFlights } from './lib/flight-engine.js';
import { buildAffiliateLink, buildAllAffiliateLinks, getAffiliateConfig } from './lib/affiliate-links.js';
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
import { startRuntimeLifecycle } from './bootstrap/runtime-lifecycle.js';
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
import { createPayloadHardeningMiddleware, safeJsonByteLength } from './middleware/payload-hardening.js';
import { logger, requestLogger } from './lib/logger.js';
import { anonymizeIpForLogs, hashValueForLogs, redactUrlForLogs } from './lib/log-redaction.js';
import { getDataFoundationStatus, runIngestionJobsMaintenance } from './lib/deal-engine-store.js';
import { getFollowSignalsSummary, getOpportunityIntelligenceDebugStats, getOpportunityPipelineStats } from './lib/opportunity-store.js';
import { getDiscoveryFeedRuntimeMetrics } from './lib/discovery-feed-service.js';
import { getRuntimeConfigAudit } from './lib/runtime-config.js';
import { evaluateStartupReadiness } from './lib/startup-readiness.js';
import { parseFlag } from './lib/env-flags.js';
import { createAiIntentService } from './lib/ai-intent-service.js';
import {
  getAccessTokenFromCookie as readAccessTokenFromCookie,
  getAuthToken as resolveRequestAuthToken,
  getCookies,
  getRefreshTokenFromCookie as readRefreshTokenFromCookie
} from './lib/auth-request-utils.js';
import { buildDestinationInsights } from './lib/destination-insights.js';
import { canUseAITravel, canUseRadar, resolveUserPlan } from './lib/plan-access.js';
import { createNotificationScanService } from './lib/notification-scan-service.js';
import { buildAdminBackofficeReport } from './lib/admin-backoffice-report.js';
import { createAuditCheck, runFeatureAudit as runFeatureAuditModule } from './lib/feature-audit.js';
import { extractJsonObject, parseDecisionAiPayload, parseIntentAiPayload } from './lib/ai-output-guards.js';

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
const NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();

function isStrongOutboundClickSecret(secretValue, jwtSecretValue = process.env.JWT_SECRET) {
  const secret = String(secretValue || '').trim();
  if (secret.length < 24) return false;
  if (/dev_outbound_secret|changeme|replace-with|example|default|secret/i.test(secret)) return false;
  const jwtSecret = String(jwtSecretValue || '').trim();
  if (jwtSecret && secret === jwtSecret) return false;
  return true;
}

function resolveOutboundClickSecret() {
  const configured = String(process.env.OUTBOUND_CLICK_SECRET || '').trim();
  if (isStrongOutboundClickSecret(configured)) return configured;
  if (NODE_ENV === 'production') {
    logger.fatal(
      {
        reason: 'missing_or_weak_outbound_click_secret',
        hint: 'Set OUTBOUND_CLICK_SECRET to a unique secret (>=24 chars) and distinct from JWT_SECRET.'
      },
      'startup_blocked_missing_required_runtime_config'
    );
    process.exit(1);
  }
  const ephemeral = randomBytes(32).toString('hex');
  logger.warn('OUTBOUND_CLICK_SECRET missing/weak in non-production; generated ephemeral secret for this process');
  return ephemeral;
}

const OUTBOUND_CLICK_SECRET = resolveOutboundClickSecret();
const OUTBOUND_CLICK_TTL_SECONDS = Number(process.env.OUTBOUND_CLICK_TTL_SECONDS || 300);
const ADMIN_TELEMETRY_MAX_BODY_BYTES = Math.max(
  1024,
  Math.min(32768, Number(process.env.ADMIN_TELEMETRY_MAX_BODY_BYTES || 8192))
);
const ADMIN_TELEMETRY_ALLOWED_SKEW_MS = Math.max(
  60 * 1000,
  Math.min(7 * 24 * 60 * 60 * 1000, Number(process.env.ADMIN_TELEMETRY_ALLOWED_SKEW_MS || 24 * 60 * 60 * 1000))
);
const ADMIN_TELEMETRY_DEDUPE_WINDOW_MS = Math.max(250, Number(process.env.TELEMETRY_DEDUPE_WINDOW_MS || 2500));
const API_MAX_BODY_BYTES = Math.max(8 * 1024, Math.min(256 * 1024, Number(process.env.API_MAX_BODY_BYTES || 64 * 1024)));
const AUTH_MAX_BODY_BYTES = Math.max(4 * 1024, Math.min(64 * 1024, Number(process.env.AUTH_MAX_BODY_BYTES || 12 * 1024)));
const OUTBOUND_MAX_BODY_BYTES = Math.max(4 * 1024, Math.min(64 * 1024, Number(process.env.OUTBOUND_MAX_BODY_BYTES || 16 * 1024)));
const OUTBOUND_MAX_QUERY_CHARS = Math.max(256, Math.min(4096, Number(process.env.OUTBOUND_MAX_QUERY_CHARS || 1600)));
const PAYLOAD_MAX_DEPTH = Math.max(2, Math.min(24, Number(process.env.PAYLOAD_MAX_DEPTH || 8)));
const PAYLOAD_MAX_NODES = Math.max(50, Math.min(20_000, Number(process.env.PAYLOAD_MAX_NODES || 600)));
const PAYLOAD_MAX_ARRAY_LENGTH = Math.max(10, Math.min(5000, Number(process.env.PAYLOAD_MAX_ARRAY_LENGTH || 250)));
const PAYLOAD_MAX_OBJECT_KEYS = Math.max(10, Math.min(5000, Number(process.env.PAYLOAD_MAX_OBJECT_KEYS || 250)));
const PAYLOAD_MAX_STRING_LENGTH = Math.max(128, Math.min(200_000, Number(process.env.PAYLOAD_MAX_STRING_LENGTH || 8192)));
const PAYLOAD_MAX_KEY_LENGTH = Math.max(16, Math.min(512, Number(process.env.PAYLOAD_MAX_KEY_LENGTH || 96)));
const TELEMETRY_BURST_WINDOW_MS = Math.max(1000, Math.min(60_000, Number(process.env.ADMIN_TELEMETRY_BURST_WINDOW_MS || 10_000)));
const TELEMETRY_BURST_MAX = Math.max(1, Math.min(100, Number(process.env.ADMIN_TELEMETRY_BURST_MAX || 4)));
const ACCESS_COOKIE_NAME = 'flight_access_token';
const REFRESH_COOKIE_NAME = 'flight_refresh_token';
const OAUTH_BINDING_COOKIE_NAME = 'flight_oauth_bind';
const ACCESS_COOKIE_TTL_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_COOKIE_DOMAIN = String(process.env.AUTH_COOKIE_DOMAIN || '').trim() || null;
const DEFAULT_CORS_ALLOWLIST = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'];

function splitCsvValues(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeOriginValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

const DERIVED_FRONTEND_ORIGIN = normalizeOriginValue(process.env.FRONTEND_ORIGIN || FRONTEND_URL);
const ENV_CORS_ALLOWLIST = [
  ...splitCsvValues(process.env.CORS_ORIGIN),
  ...splitCsvValues(process.env.FRONTEND_ORIGIN),
  ...splitCsvValues(process.env.CORS_ALLOWLIST),
  DERIVED_FRONTEND_ORIGIN
]
  .map((entry) => normalizeOriginValue(entry))
  .filter(Boolean);
const CORS_ALLOWLIST = new Set(ENV_CORS_ALLOWLIST.length > 0 ? ENV_CORS_ALLOWLIST : process.env.NODE_ENV === 'production' ? [] : DEFAULT_CORS_ALLOWLIST);
const ADMIN_ALLOWLIST_EMAILS = new Set(
  [process.env.ADMIN_ALLOWLIST_EMAILS, process.env.BACKOFFICE_ADMIN_EMAILS]
    .filter((value) => String(value || '').trim().length > 0)
    .join(',')
    .split(',')
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
);
if (ADMIN_ALLOWLIST_EMAILS.size === 0 && process.env.NODE_ENV !== 'production') {
  logger.warn('ADMIN_ALLOWLIST_EMAILS not configured — admin endpoints will be inaccessible. Set ADMIN_ALLOWLIST_EMAILS or BACKOFFICE_ADMIN_EMAILS.');
}
const ADMIN_DASHBOARD_ENABLED = String(process.env.ADMIN_DASHBOARD_ENABLED || 'true').trim().toLowerCase() !== 'false';
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || process.env.RL_API_PER_MINUTE || 120);
const RL_AUTH_PER_MINUTE = Number(process.env.RL_AUTH_PER_MINUTE || 15);
const RL_OUTBOUND_PER_MINUTE = Math.max(10, Number(process.env.RL_OUTBOUND_PER_MINUTE || 120));
const RL_OUTBOUND_PER_SECOND = Math.max(1, Number(process.env.RL_OUTBOUND_PER_SECOND || 10));
const RL_TELEMETRY_PER_SECOND = Math.max(1, Number(process.env.RL_TELEMETRY_PER_SECOND || 10));
const AUTH_REQUIRE_TRUSTED_ORIGIN =
  String(process.env.AUTH_REQUIRE_TRUSTED_ORIGIN || (process.env.NODE_ENV === 'production' ? 'true' : 'false'))
    .trim()
    .toLowerCase() !== 'false';
const AUTH_RETURN_ACCESS_TOKEN =
  String(process.env.AUTH_RETURN_ACCESS_TOKEN || (process.env.NODE_ENV === 'production' ? 'false' : 'true'))
    .trim()
    .toLowerCase() === 'true';
const REGISTRATION_ENABLED = String(process.env.AUTH_REGISTRATION_ENABLED || process.env.REGISTRATION_ENABLED || 'true')
  .trim()
  .toLowerCase() !== 'false';
const LEGACY_AUTH_ROUTES_ENABLED = parseFlag(process.env.LEGACY_AUTH_ROUTES_ENABLED, NODE_ENV !== 'production');
const MOCK_BILLING_UPGRADES_ENABLED = parseFlag(process.env.ALLOW_MOCK_BILLING_UPGRADES, NODE_ENV !== 'production');
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
  TRUST_PROXY_RAW === ''
    ? process.env.NODE_ENV === 'production'
      ? 1
      : false
    : TRUST_PROXY_RAW === 'false' || TRUST_PROXY_RAW === '0'
    ? false
    : TRUST_PROXY_RAW === 'true'
    ? 1
    : Number.isFinite(Number(TRUST_PROXY_RAW))
    ? Number(TRUST_PROXY_RAW)
    : TRUST_PROXY_RAW;

if (NODE_ENV === 'production' && MOCK_BILLING_UPGRADES_ENABLED) {
  logger.fatal(
    {
      envKey: 'ALLOW_MOCK_BILLING_UPGRADES',
      hint: 'Disable mock billing upgrade routes in production.'
    },
    'startup_blocked_insecure_mock_billing_flag'
  );
  process.exit(1);
}

if (process.env.NODE_ENV === 'production' && CORS_ALLOWLIST.size === 0) {
  if (!INSECURE_STARTUP_BYPASS_ENABLED) {
    logger.fatal(
      {
        corsOriginsConfigured: CORS_ALLOWLIST.size,
        hint: 'Set CORS_ALLOWLIST, CORS_ORIGIN or FRONTEND_ORIGIN.'
      },
      'startup_blocked_missing_cors_allowlist'
    );
    process.exit(1);
  }
  logger.warn(
    {
      corsOriginsConfigured: CORS_ALLOWLIST.size,
      hint: 'Production CORS allowlist is empty. Startup bypass flag allowed this process to continue.'
    },
    'startup_insecure_empty_cors_allowlist'
  );
}

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
  return res.status(status).json(payload);
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

// ── Startup capability warnings ────────────────────────────────────────────
// Surface explicit structured warnings when optional-but-important integrations
// are missing, so operators see them immediately on boot rather than discovering
// silent no-ops in production.
{
  const pushUrl = String(process.env.PUSH_WEBHOOK_URL || '').trim();
  if (!pushUrl) {
    logger.warn(
      { capability: 'push_notifications', impact: 'alerts_dead_lettered' },
      'startup_capability_missing_push_webhook_url: push notifications disabled, triggered alerts will be saved to dead-letter queue only. Set PUSH_WEBHOOK_URL to enable delivery.'
    );
  }

  const smtpHost = String(process.env.SMTP_HOST || '').trim();
  if (!smtpHost) {
    logger.warn(
      { capability: 'email_smtp', impact: 'emails_not_sent_accounts_auto_verified' },
      'startup_capability_missing_smtp: email delivery disabled. Password reset emails will not be sent. New accounts are auto-verified. Set SMTP_HOST/USER/PASS to enable.'
    );
  }

  const billingProvider = String(process.env.BILLING_PROVIDER || 'braintree').trim().toLowerCase();
  const btConfigured = String(process.env.BT_MERCHANT_ID || '').trim() &&
                       String(process.env.BT_PUBLIC_KEY || '').trim() &&
                       String(process.env.BT_PRIVATE_KEY || '').trim();
  const stripeConfigured = String(process.env.STRIPE_SECRET_KEY || '').trim().length >= 16;
  const billingConfigured = billingProvider === 'stripe' ? stripeConfigured : btConfigured;
  if (!billingConfigured) {
    logger.warn(
      { capability: 'billing', provider: billingProvider, impact: 'upgrades_unavailable' },
      `startup_capability_missing_billing: billing provider '${billingProvider}' credentials not configured. Subscription upgrades will return 503. Set ${billingProvider === 'stripe' ? 'STRIPE_SECRET_KEY' : 'BT_MERCHANT_ID/BT_PUBLIC_KEY/BT_PRIVATE_KEY'} to enable.`
    );
  }

  const flightScanEnabled = String(process.env.FLIGHT_SCAN_ENABLED || '').trim().toLowerCase() === 'true';
  const liveProviders = String(process.env.ENABLE_PROVIDER_DUFFEL || '').trim().toLowerCase() === 'true' ||
                        String(process.env.ENABLE_PROVIDER_AMADEUS || '').trim().toLowerCase() === 'true';
  if (!liveProviders) {
    logger.warn(
      { capability: 'live_flight_providers', impact: 'synthetic_data_only' },
      'startup_capability_disabled_live_providers: no live flight provider enabled. Search results and deals are based on internal synthetic data. Set ENABLE_PROVIDER_DUFFEL=true or ENABLE_PROVIDER_AMADEUS=true with credentials to enable live prices.'
    );
  } else if (!flightScanEnabled) {
    logger.warn(
      { capability: 'flight_scan', impact: 'providers_configured_but_scan_off' },
      'startup_capability_missing_flight_scan: live providers are configured but FLIGHT_SCAN_ENABLED=false. Provider data will not be collected. Set FLIGHT_SCAN_ENABLED=true to activate.'
    );
  }
}
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
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(10)
    .max(64)
    .regex(/[a-z]/, 'Password must include a lowercase letter.')
    .regex(/[A-Z]/, 'Password must include an uppercase letter.')
    .regex(/[0-9]/, 'Password must include a number.')
    .regex(/[^A-Za-z0-9]/, 'Password must include a special character.')
}).strict();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(64)
}).strict();

const passwordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254)
}).strict();

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
}).strict();

const emailVerifySchema = z.object({
  token: z.string().trim().min(32).max(256)
}).strict();

const mfaCodeSchema = z.object({
  code: z.string().trim().min(6).max(8)
}).strict();

const loginMfaVerifySchema = z.object({
  ticket: z.string().min(10).max(80),
  code: z.string().trim().min(6).max(8)
}).strict();

const onboardingCompleteSchema = z.object({
  intent: z.enum(['deals', 'family', 'business', 'weekend']).optional(),
  budget: z.number().int().positive().max(20000).optional(),
  preferredRegion: z.enum(REGION_ENUM).optional(),
  directOnly: z.boolean().optional()
}).strict();

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isStrictIsoDate(value) {
  const text = String(value || '').trim();
  if (!ISO_DATE_PATTERN.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === text;
}

const multiCitySegmentSchema = z.object({
  origin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Invalid segment origin IATA code.'),
  destination: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Invalid segment destination IATA code.'),
  date: z.string().trim().regex(ISO_DATE_PATTERN, 'Invalid segment date format. Use YYYY-MM-DD.')
}).strict();

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
    cabinClass: z.enum(CABIN_ENUM),
    mode: z.enum(['single', 'multi_city']).optional(),
    segments: z.array(multiCitySegmentSchema).min(2).max(6).optional()
  })
  .strict()
  .superRefine((payload, ctx) => {
    const mode = payload.mode === 'multi_city' ? 'multi_city' : 'single';
    if (mode === 'multi_city') {
      if (!Array.isArray(payload.segments) || payload.segments.length < 2 || payload.segments.length > 6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Multi-city search requires 2 to 6 segments.'
        });
        return;
      }

      let previousDate = null;
      for (let index = 0; index < payload.segments.length; index += 1) {
        const segment = payload.segments[index];
        if (!isStrictIsoDate(segment.date)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['segments', index, 'date'],
            message: 'Invalid segment date.'
          });
          continue;
        }
        const currentDate = new Date(segment.date);
        if (segment.origin === segment.destination) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['segments', index, 'destination'],
            message: 'Origin and destination cannot be the same in a segment.'
          });
        }
        if (previousDate && currentDate < previousDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['segments', index, 'date'],
            message: 'Segment dates cannot be in reverse order.'
          });
        }
        previousDate = currentDate;
      }
      return;
    }

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
  .strict()
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
}).strict();

const watchlistSchema = z.object({
  flightId: z.string().min(1),
  destination: z.string().min(1),
  destinationIata: z.string().min(3).max(3),
  price: z.number().positive(),
  dateFrom: z.string(),
  dateTo: z.string(),
  link: z.string().url()
}).strict();

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
}).strict();

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
  .strict()
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
  .strict()
  .superRefine((payload, ctx) => {
    if (!payload.destinationQuery && !payload.destinationIata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide destinationQuery or destinationIata.'
      });
    }
  });

const ADMIN_TELEMETRY_EVENT_TYPES = [
  'result_interaction_clicked',
  'itinerary_opened',
  'booking_clicked',
  'upgrade_cta_clicked',
  'elite_cta_clicked',
  'upgrade_modal_opened',
  'elite_modal_opened',
  'upgrade_primary_cta_clicked',
  'radar_activated'
];
const ADMIN_TELEMETRY_SOURCE_CONTEXT = ['web_app', 'admin_backoffice', 'api_client'];

const adminTelemetryEventSchema = z.object({
  eventType: z.enum(ADMIN_TELEMETRY_EVENT_TYPES),
  at: z.string().datetime().optional(),
  eventId: z.string().regex(/^[a-z0-9_-]{8,80}$/i).optional(),
  fingerprint: z.string().regex(/^[a-z0-9_-]{12,128}$/i).optional(),
  eventVersion: z.number().int().min(1).max(10).optional(),
  schemaVersion: z.number().int().min(1).max(10).optional(),
  sourceContext: z.enum(ADMIN_TELEMETRY_SOURCE_CONTEXT).optional(),
  action: z.string().max(80).optional(),
  surface: z.string().max(80).optional(),
  itineraryId: z.string().max(120).optional(),
  correlationId: z.string().max(180).optional(),
  source: z.string().max(120).optional(),
  routeSlug: z.string().max(120).optional(),
  planType: z.enum(['free', 'pro', 'elite']).optional()
}).strict();

function sanitizeTelemetryText(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, Math.max(1, Number(maxLength) || 120));
}

function safeTelemetryVersion(value, fallbackValue) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function resolveTelemetryAt(clientAt) {
  const nowMs = Date.now();
  const parsedMs = new Date(clientAt || '').getTime();
  if (!Number.isFinite(parsedMs)) return new Date(nowMs).toISOString();
  if (Math.abs(parsedMs - nowMs) > ADMIN_TELEMETRY_ALLOWED_SKEW_MS) return new Date(nowMs).toISOString();
  return new Date(parsedMs).toISOString();
}

function buildTelemetryFingerprint(payload, userId) {
  const base = [
    String(userId || ''),
    String(payload.eventType || ''),
    String(payload.action || ''),
    String(payload.surface || ''),
    String(payload.source || ''),
    String(payload.routeSlug || ''),
    String(payload.planType || ''),
    String(payload.correlationId || ''),
    String(payload.itineraryId || '')
  ].join('|');
  return createHash('sha256').update(base).digest('hex').slice(0, 48);
}

function getAccessTokenFromCookie(req) {
  return readAccessTokenFromCookie(req, ACCESS_COOKIE_NAME);
}

function getRefreshTokenFromCookie(req) {
  return readRefreshTokenFromCookie(req, REFRESH_COOKIE_NAME);
}

function getAuthToken(req) {
  return resolveRequestAuthToken(req, ACCESS_COOKIE_NAME);
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
  const nowSec = Math.floor(Date.now() / 1000);
  let result = { ok: false, reason: 'not_found' };
  await withDb(async (db) => {
    const oldSession = (db.refreshSessions || []).find((session) => session.jti === oldJti) || null;
    if (!oldSession || oldSession.userId !== userId || oldSession.family !== family) {
      result = { ok: false, reason: 'not_found' };
      return db;
    }
    if (oldSession.revokedAt) {
      result = { ok: false, reason: 'reused' };
      return db;
    }
    if (Number.isFinite(oldSession.exp) && oldSession.exp <= nowSec) {
      result = { ok: false, reason: 'expired' };
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
    result = { ok: true, reason: null };
    return db;
  });
  return result;
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

function hashEmailVerifyToken(token) {
  return createHash('sha256').update(`email_verify:${String(token || '')}`).digest('hex');
}

function buildEmailVerifyUrl(rawToken) {
  const base = process.env.EMAIL_VERIFY_URL || `${FRONTEND_URL}/`;
  const url = new URL(base);
  url.searchParams.set('verify_token', rawToken);
  return url.toString();
}

async function logAuthEvent({ userId = null, email = '', type, success, req, detail = '' }) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const event = {
    id: nanoid(10),
    at: new Date().toISOString(),
    userId,
    emailHash: normalizedEmail ? hashValueForLogs(normalizedEmail, { label: 'email', length: 24 }) : null,
    type,
    success: Boolean(success),
    ipHash: anonymizeIpForLogs(getClientIp(req)),
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
    emailHash: event.emailHash,
    type,
    success: Boolean(success),
    ipHash: event.ipHash,
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
          path: redactUrlForLogs(req.originalUrl || req.url, { maxLength: 220 }),
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

function isAdminEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return ADMIN_ALLOWLIST_EMAILS.has(normalized);
}

function adminGuard(req, res, next) {
  if (!ADMIN_DASHBOARD_ENABLED) return sendMachineError(req, res, 404, 'admin_not_enabled');
  if (isAdminEmail(req.user?.email)) return next();
  return sendMachineError(req, res, 403, 'admin_access_denied');
}

function requireSessionAuth(req, res, next) {
  if (req.authSource === 'cookie') return next();
  return sendMachineError(req, res, 403, 'session_auth_required');
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

function buildSessionResponsePayload(accessToken, payload) {
  if (AUTH_RETURN_ACCESS_TOKEN) return { token: accessToken, ...payload };
  return payload;
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

function hashOAuthBindingToken(rawToken) {
  return createHash('sha256').update(String(rawToken || '')).digest('hex');
}

function getOAuthBindingToken(req) {
  const cookies = getCookies(req);
  return String(cookies[OAUTH_BINDING_COOKIE_NAME] || '').trim();
}

function oauthBindingCookieOptions(req, maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(isSecureRequest(req) || NODE_ENV === 'production'),
    path: '/api/auth/oauth',
    maxAge: maxAgeMs,
    ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {})
  };
}

function ensureOAuthBrowserBinding(req, res) {
  const safeTtlMs = Math.max(60, Math.min(900, OAUTH_SESSION_TTL_SECONDS)) * 1000;
  let bindingToken = getOAuthBindingToken(req);
  if (!bindingToken || bindingToken.length < 24) {
    bindingToken = toBase64Url(randomBytes(32));
  }
  res.cookie(OAUTH_BINDING_COOKIE_NAME, bindingToken, oauthBindingCookieOptions(req, safeTtlMs));
  return hashOAuthBindingToken(bindingToken);
}

function resolveOAuthBindingHash(req) {
  const bindingToken = getOAuthBindingToken(req);
  if (!bindingToken || bindingToken.length < 24) return null;
  return hashOAuthBindingToken(bindingToken);
}

function clearOAuthBrowserBinding(req, res) {
  res.clearCookie(OAUTH_BINDING_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: oauthBindingCookieOptions(req, 1).secure,
    path: '/api/auth/oauth',
    ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {})
  });
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

async function createOAuthSession(provider, redirectUri, bindingHash) {
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
    bindingHash: String(bindingHash || ''),
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

async function consumeOAuthSessionById({ id, provider, state, bindingHash }) {
  let session = null;
  await withDb(async (db) => {
    session = (db.oauthSessions || []).find((item) => item.id === id && item.provider === provider && !item.consumedAt) || null;
    if (!session) return db;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return db;
    if (state && session.state !== state) return db;
    if (String(session.bindingHash || '') !== String(bindingHash || '')) return db;
    session.consumedAt = new Date().toISOString();
    return db;
  });
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  if (state && session.state !== state) return null;
  if (String(session.bindingHash || '') !== String(bindingHash || '')) return null;
  return session;
}

async function consumeOAuthSessionByState({ provider, state, bindingHash }) {
  let session = null;
  await withDb(async (db) => {
    session = (db.oauthSessions || []).find((item) => item.provider === provider && item.state === state && !item.consumedAt) || null;
    if (!session) return db;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return db;
    if (String(session.bindingHash || '') !== String(bindingHash || '')) return db;
    session.consumedAt = new Date().toISOString();
    return db;
  });
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  if (String(session.bindingHash || '') !== String(bindingHash || '')) return null;
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
  return buildSessionResponsePayload(accessToken, {
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
const { enrichDecisionWithAi, parseIntentWithAi } = createAiIntentService({
  origins: ORIGINS,
  extractJsonObject,
  parseDecisionAiPayload,
  parseIntentAiPayload
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

app.post('/api/admin/telemetry', telemetryBurstLimiter, telemetryEventLimiter, authGuard, requireSessionAuth, csrfGuard, async (req, res) => {
  const rawBody = req.body;
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return sendMachineError(req, res, 400, 'invalid_payload');
  }
  const bodySize = safeJsonByteLength(rawBody);
  if (!Number.isFinite(bodySize) || bodySize > ADMIN_TELEMETRY_MAX_BODY_BYTES) {
    return sendMachineError(req, res, 413, 'payload_too_large');
  }

  const parsed = adminTelemetryEventSchema.safeParse(rawBody);
  if (!parsed.success) return sendMachineError(req, res, 400, 'invalid_payload');

  const payload = parsed.data;
  const userId = String(req.user?.sub || req.user?.id || '').trim() || null;
  const telemetryUser = userId ? await fetchCurrentUser(userId) : null;
  const resolvedPlanType = telemetryUser ? resolveUserPlan(telemetryUser).planType : null;
  if (payload.planType && resolvedPlanType && payload.planType !== resolvedPlanType) {
    logger.warn(
      {
        request_id: req.id || null,
        user_id: userId,
        claimed_plan_type: payload.planType,
        resolved_plan_type: resolvedPlanType
      },
      'admin_telemetry_plan_type_overridden'
    );
  }
  const derivedFingerprint = buildTelemetryFingerprint(
    {
      ...payload,
      planType: resolvedPlanType || null
    },
    userId || 'anonymous'
  );
  const trustedSourceContext = 'web_app';
  const eventRecord = {
    id: nanoid(10),
    at: resolveTelemetryAt(payload.at),
    userId,
    email: null,
    eventId: derivedFingerprint,
    fingerprint: derivedFingerprint,
    eventVersion: 1,
    schemaVersion: 2,
    sourceContext: trustedSourceContext,
    eventType: payload.eventType,
    action: sanitizeTelemetryText(payload.action, 80) || null,
    surface: sanitizeTelemetryText(payload.surface, 80) || null,
    itineraryId: sanitizeTelemetryText(payload.itineraryId, 120) || null,
    correlationId: sanitizeTelemetryText(payload.correlationId, 180) || null,
    source: sanitizeTelemetryText(payload.source, 120) || null,
    routeSlug: sanitizeTelemetryText(payload.routeSlug, 120) || null,
    planType: resolvedPlanType || null,
    trustLevel: 'session_bound_client'
  };

  let rejectedForBurst = false;
  let burstResetAt = null;
  await withDb(async (db) => {
    db.clientTelemetryEvents = Array.isArray(db.clientTelemetryEvents) ? db.clientTelemetryEvents : [];
    const eventAtMs = new Date(eventRecord.at).getTime();
    const recentSameFingerprintCount = db.clientTelemetryEvents.reduce((count, candidate) => {
      if (!candidate || typeof candidate !== 'object') return count;
      if (String(candidate.userId || '') !== String(eventRecord.userId || '')) return count;
      if (String(candidate.fingerprint || '') !== String(eventRecord.fingerprint || '')) return count;
      const candidateAt = new Date(candidate.at || '').getTime();
      if (!Number.isFinite(candidateAt) || !Number.isFinite(eventAtMs)) return count;
      if (Math.abs(eventAtMs - candidateAt) > TELEMETRY_BURST_WINDOW_MS) return count;
      return count + 1;
    }, 0);
    if (recentSameFingerprintCount >= TELEMETRY_BURST_MAX) {
      rejectedForBurst = true;
      burstResetAt = new Date(eventAtMs + TELEMETRY_BURST_WINDOW_MS).toISOString();
      return db;
    }

    const hasDuplicate = db.clientTelemetryEvents.some((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false;
      if (String(candidate.userId || '') !== String(eventRecord.userId || '')) return false;
      if (eventRecord.eventId && String(candidate.eventId || '') === String(eventRecord.eventId || '')) return true;
      if (eventRecord.fingerprint && String(candidate.fingerprint || '') === String(eventRecord.fingerprint || '')) return true;
      if (String(candidate.eventType || '') !== String(eventRecord.eventType || '')) return false;
      if (String(candidate.action || '') !== String(eventRecord.action || '')) return false;
      if (String(candidate.surface || '') !== String(eventRecord.surface || '')) return false;
      if (String(candidate.source || '') !== String(eventRecord.source || '')) return false;
      if (String(candidate.planType || '') !== String(eventRecord.planType || '')) return false;
      if (String(candidate.routeSlug || '') !== String(eventRecord.routeSlug || '')) return false;
      if (String(candidate.correlationId || '') !== String(eventRecord.correlationId || '')) return false;
      if (String(candidate.itineraryId || '') !== String(eventRecord.itineraryId || '')) return false;
      const candidateAt = new Date(candidate.at || '').getTime();
      if (!Number.isFinite(candidateAt) || !Number.isFinite(eventAtMs)) return false;
      return Math.abs(eventAtMs - candidateAt) <= ADMIN_TELEMETRY_DEDUPE_WINDOW_MS;
    });
    if (hasDuplicate) return db;
    db.clientTelemetryEvents.push(eventRecord);
    db.clientTelemetryEvents = db.clientTelemetryEvents.slice(-12000);
    return db;
  });
  if (rejectedForBurst) {
    return sendMachineError(req, res, 429, 'rate_limited', { reset_at: burstResetAt || toIsoFromRateLimit(req) });
  }

  return res.status(201).json({ ok: true });
});

app.get('/api/admin/backoffice/report', authGuard, requireSessionAuth, adminGuard, async (_req, res) => {
  let report = null;
  const followSignals = await getFollowSignalsSummary({ limit: 10 }).catch(() => ({ total: 0, topRoutes: [] }));
  await withDb(async (db) => {
    report = buildAdminBackofficeReport({ db, followSignals, now: Date.now(), windowDays: 30 });
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
    nanoid,
    sendMachineError,
    captureUserPriceObservation,
    searchProviderOffers: (params) => dataProviderRegistry.searchOffers(params),
    cacheClient: getCacheClient()
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
    loginDummyPasswordHash: LOGIN_DUMMY_PASSWORD_HASH
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

/**
 * Returns affiliate booking links for all configured partners for a given itinerary.
 * Used by the frontend to show "Book on Kiwi / Skyscanner / etc." CTAs.
 */
app.get('/api/affiliate/links', async (req, res) => {
  const { origin, destination, dateFrom, dateTo, travellers = '1', cabin = 'economy' } = req.query;
  if (!origin || !destination || !dateFrom) {
    return res.status(400).json({ error: 'origin, destination and dateFrom are required.' });
  }
  const links = buildAllAffiliateLinks({
    origin: String(origin).toUpperCase().slice(0, 3),
    destinationIata: String(destination).toUpperCase().slice(0, 3),
    dateFrom: String(dateFrom).slice(0, 10),
    dateTo: dateTo ? String(dateTo).slice(0, 10) : null,
    travellers: Math.min(9, Math.max(1, Number(travellers) || 1)),
    cabinClass: ['economy', 'premium', 'business'].includes(String(cabin)) ? cabin : 'economy'
  });
  return res.json({ links });
});

app.post('/api/insights/destination', authGuard, csrfGuard, premiumGuard, requireApiScope('search'), quotaGuard({ counter: 'decision', amount: 1 }), async (req, res) => {
  const parsed = destinationInsightSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

  const result = buildDestinationInsights(parsed.data, { searchFlights });
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
app.use('/api/push',    buildPushRouter({ authGuard, csrfGuard }));
app.use('/api/keys',    buildApiKeysRouter({ authGuard, csrfGuard }));
app.use('/api/billing', buildBillingRouter({ authGuard, requireSessionAuth, csrfGuard }));
app.use('/api/usage',   buildUsageRouter({ authGuard }));
app.use('/api',         buildUserExportRouter({ authGuard, requireSessionAuth, quotaGuard, withDb, readDb }));
app.use('/', buildDealEngineRouter());
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
    providerCollectionEffectiveEnabled: PROVIDER_COLLECTION_EFFECTIVE_ENABLED
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



