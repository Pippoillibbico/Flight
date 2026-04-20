import { randomBytes } from 'node:crypto';
import { parseFlag } from './env-flags.js';

function isStrongOutboundClickSecret(secretValue, jwtSecretValue) {
  const secret = String(secretValue || '').trim();
  if (secret.length < 24) return false;
  if (/dev_outbound_secret|changeme|replace-with|example|default|secret/i.test(secret)) return false;
  const jwtSecret = String(jwtSecretValue || '').trim();
  if (jwtSecret && secret === jwtSecret) return false;
  return true;
}

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

function resolveTrustProxyValue({ trustProxyRaw, nodeEnv }) {
  if (trustProxyRaw === '') {
    return nodeEnv === 'production' ? 1 : false;
  }
  if (trustProxyRaw === 'false' || trustProxyRaw === '0') return false;
  if (trustProxyRaw === 'true') return 1;
  if (Number.isFinite(Number(trustProxyRaw))) return Number(trustProxyRaw);
  return trustProxyRaw;
}

function resolveOutboundClickSecret({ env, nodeEnv, logger }) {
  const configured = String(env.OUTBOUND_CLICK_SECRET || '').trim();
  if (isStrongOutboundClickSecret(configured, env.JWT_SECRET)) return configured;
  if (nodeEnv === 'production') {
    logger.fatal(
      {
        reason: 'missing_or_weak_outbound_click_secret',
        hint: 'Set OUTBOUND_CLICK_SECRET to a unique secret (>=24 chars) and distinct from JWT_SECRET.'
      },
      'startup_blocked_missing_required_runtime_config'
    );
    throw new Error('startup_blocked_missing_required_runtime_config');
  }
  const ephemeral = randomBytes(32).toString('hex');
  logger.warn('OUTBOUND_CLICK_SECRET missing/weak in non-production; generated ephemeral secret for this process');
  return ephemeral;
}

export function loadServerRuntimeConfig({ env = process.env, logger }) {
  const PORT = Number(env.PORT || 3000);
  const CRON_SCHEDULE = env.NOTIFICATION_CRON || '*/10 * * * *';
  const LOGIN_MAX_FAILURES = 5;
  const LOGIN_LOCK_MINUTES = 15;
  const OAUTH_SESSION_TTL_SECONDS = Number(env.OAUTH_SESSION_TTL_SECONDS || 300);
  const FRONTEND_URL = env.FRONTEND_URL || 'http://localhost:5173';
  const GOOGLE_OAUTH_REDIRECT_URI = env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/oauth/google/callback';
  const APPLE_OAUTH_REDIRECT_URI = env.APPLE_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/oauth/apple/callback';
  const FACEBOOK_OAUTH_REDIRECT_URI = env.FACEBOOK_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/oauth/facebook/callback';
  const AI_PRICING_CRON = env.AI_PRICING_CRON || '0 0,8 * * *';
  const AI_PRICING_CRON_TIMEZONE = env.AI_PRICING_CRON_TIMEZONE || 'Europe/Rome';
  const AI_TARGET_MARGIN = Number(env.AI_TARGET_MARGIN || 0.72);
  const AI_USAGE_GROWTH_FACTOR = Number(env.AI_USAGE_GROWTH_FACTOR || 1.15);
  const AI_PLATFORM_OVERHEAD_EUR = Number(env.AI_PLATFORM_OVERHEAD_EUR || 2.2);
  const AI_SAFETY_BUFFER_EUR = Number(env.AI_SAFETY_BUFFER_EUR || 1.4);
  const AI_COST_FEED_URL = String(env.AI_COST_FEED_URL || '').trim();
  const FREE_PRECOMPUTE_CRON = env.FREE_PRECOMPUTE_CRON || '20 2 * * *';
  const FREE_ALERT_WORKER_CRON = env.FREE_ALERT_WORKER_CRON || '*/15 * * * *';
  const FREE_JOBS_TIMEZONE = env.FREE_JOBS_TIMEZONE || 'UTC';
  const DEAL_BASELINE_CRON = env.DEAL_BASELINE_CRON || '10 1 * * *';
  const DEAL_BASELINE_CRON_TIMEZONE = env.DEAL_BASELINE_CRON_TIMEZONE || FREE_JOBS_TIMEZONE;
  const DISCOVERY_ALERT_WORKER_CRON = env.DISCOVERY_ALERT_WORKER_CRON || '*/20 * * * *';
  const DISCOVERY_ALERT_WORKER_TIMEZONE = env.DISCOVERY_ALERT_WORKER_TIMEZONE || FREE_JOBS_TIMEZONE;
  const PRICE_INGEST_WORKER_CRON = env.PRICE_INGEST_WORKER_CRON || '*/5 * * * *';
  const PRICE_INGEST_WORKER_TIMEZONE = env.PRICE_INGEST_WORKER_TIMEZONE || FREE_JOBS_TIMEZONE;
  const PROVIDER_COLLECTION_ENABLED = String(env.PROVIDER_COLLECTION_ENABLED || 'false').trim().toLowerCase() === 'true';
  const SCAN_PROVIDER_OVERLAP_POLICY = String(env.SCAN_PROVIDER_OVERLAP_POLICY || 'mutual_exclusive').trim().toLowerCase();
  const PROVIDER_COLLECTION_CRON = env.PROVIDER_COLLECTION_CRON || '17 * * * *';
  const PROVIDER_COLLECTION_TIMEZONE = env.PROVIDER_COLLECTION_TIMEZONE || FREE_JOBS_TIMEZONE;
  const OPPORTUNITY_PIPELINE_CRON = env.OPPORTUNITY_PIPELINE_CRON || '*/30 * * * *';
  const OPPORTUNITY_PIPELINE_TIMEZONE = env.OPPORTUNITY_PIPELINE_TIMEZONE || FREE_JOBS_TIMEZONE;
  const INGESTION_JOBS_MAINTENANCE_CRON = env.INGESTION_JOBS_MAINTENANCE_CRON || '*/15 * * * *';
  const INGESTION_JOBS_MAINTENANCE_TIMEZONE = env.INGESTION_JOBS_MAINTENANCE_TIMEZONE || FREE_JOBS_TIMEZONE;
  const ROUTE_PRICE_STATS_ENABLED = String(env.ROUTE_PRICE_STATS_ENABLED || 'true').trim().toLowerCase() === 'true';
  const ROUTE_PRICE_STATS_CRON = env.ROUTE_PRICE_STATS_CRON || '*/30 * * * *';
  const ROUTE_PRICE_STATS_TIMEZONE = env.ROUTE_PRICE_STATS_TIMEZONE || FREE_JOBS_TIMEZONE;
  const DETECTED_DEALS_ENABLED = String(env.DETECTED_DEALS_ENABLED || 'true').trim().toLowerCase() === 'true';
  const DETECTED_DEALS_CRON = env.DETECTED_DEALS_CRON || '*/20 * * * *';
  const DETECTED_DEALS_TIMEZONE = env.DETECTED_DEALS_TIMEZONE || FREE_JOBS_TIMEZONE;
  const DEALS_CONTENT_ENABLED = String(env.DEALS_CONTENT_ENABLED || 'true').trim().toLowerCase() === 'true';
  const DEALS_CONTENT_CRON = env.DEALS_CONTENT_CRON || '15 8 * * *';
  const DEALS_CONTENT_TIMEZONE = env.DEALS_CONTENT_TIMEZONE || FREE_JOBS_TIMEZONE;
  const DEALS_CONTENT_RUN_ON_STARTUP = String(env.DEALS_CONTENT_RUN_ON_STARTUP || 'false').trim().toLowerCase() === 'true';
  const PRICE_ALERTS_ENABLED = String(env.PRICE_ALERTS_ENABLED || 'true').trim().toLowerCase() === 'true';
  const PRICE_ALERTS_CRON = env.PRICE_ALERTS_CRON || '*/10 * * * *';
  const PRICE_ALERTS_TIMEZONE = env.PRICE_ALERTS_TIMEZONE || FREE_JOBS_TIMEZONE;
  const PRICE_ALERTS_WORKER_LIMIT_RAW = Number(env.PRICE_ALERTS_WORKER_LIMIT || 500);
  const PRICE_ALERTS_WORKER_LIMIT = Number.isFinite(PRICE_ALERTS_WORKER_LIMIT_RAW)
    ? Math.max(1, Math.min(5000, PRICE_ALERTS_WORKER_LIMIT_RAW))
    : 500;
  const RADAR_MATCH_PRECOMPUTE_CRON = env.RADAR_MATCH_PRECOMPUTE_CRON || '*/40 * * * *';
  const RADAR_MATCH_PRECOMPUTE_TIMEZONE = env.RADAR_MATCH_PRECOMPUTE_TIMEZONE || FREE_JOBS_TIMEZONE;
  const FLIGHT_SCAN_ENABLED = String(env.FLIGHT_SCAN_ENABLED || 'false').trim().toLowerCase() === 'true';
  const FLIGHT_SCAN_SCHEDULER_CRON = env.FLIGHT_SCAN_SCHEDULER_CRON || '7 * * * *';
  const FLIGHT_SCAN_WORKER_CRON = env.FLIGHT_SCAN_WORKER_CRON || '*/5 * * * *';
  const FLIGHT_SCAN_TIMEZONE = env.FLIGHT_SCAN_TIMEZONE || FREE_JOBS_TIMEZONE;
  const PROVIDER_COLLECTION_EFFECTIVE_ENABLED =
    PROVIDER_COLLECTION_ENABLED && !(FLIGHT_SCAN_ENABLED && SCAN_PROVIDER_OVERLAP_POLICY === 'mutual_exclusive');
  const BOOTSTRAP_SEED_IMPORT_FILE = String(env.BOOTSTRAP_SEED_IMPORT_FILE || '').trim();
  const BOOTSTRAP_SEED_IMPORT_DRY_RUN = String(env.BOOTSTRAP_SEED_IMPORT_DRY_RUN || 'false').trim().toLowerCase() === 'true';
  const JSON_BODY_LIMIT = String(env.BODY_JSON_LIMIT || '256kb').trim() || '256kb';
  const BUILD_VERSION = String(env.BUILD_VERSION || env.npm_package_version || '0.0.0-dev').trim();
  const NODE_ENV = String(env.NODE_ENV || 'development').trim().toLowerCase();

  const OUTBOUND_CLICK_SECRET = resolveOutboundClickSecret({ env, nodeEnv: NODE_ENV, logger });
  const OUTBOUND_CLICK_TTL_SECONDS = Number(env.OUTBOUND_CLICK_TTL_SECONDS || 300);
  const ADMIN_TELEMETRY_MAX_BODY_BYTES = Math.max(1024, Math.min(32768, Number(env.ADMIN_TELEMETRY_MAX_BODY_BYTES || 8192)));
  const ADMIN_TELEMETRY_ALLOWED_SKEW_MS = Math.max(
    60 * 1000,
    Math.min(7 * 24 * 60 * 60 * 1000, Number(env.ADMIN_TELEMETRY_ALLOWED_SKEW_MS || 24 * 60 * 60 * 1000))
  );
  const ADMIN_TELEMETRY_DEDUPE_WINDOW_MS = Math.max(250, Number(env.TELEMETRY_DEDUPE_WINDOW_MS || 2500));
  const API_MAX_BODY_BYTES = Math.max(8 * 1024, Math.min(256 * 1024, Number(env.API_MAX_BODY_BYTES || 64 * 1024)));
  const AUTH_MAX_BODY_BYTES = Math.max(4 * 1024, Math.min(64 * 1024, Number(env.AUTH_MAX_BODY_BYTES || 12 * 1024)));
  const OUTBOUND_MAX_BODY_BYTES = Math.max(4 * 1024, Math.min(64 * 1024, Number(env.OUTBOUND_MAX_BODY_BYTES || 16 * 1024)));
  const OUTBOUND_MAX_QUERY_CHARS = Math.max(256, Math.min(4096, Number(env.OUTBOUND_MAX_QUERY_CHARS || 1600)));
  const PAYLOAD_MAX_DEPTH = Math.max(2, Math.min(24, Number(env.PAYLOAD_MAX_DEPTH || 8)));
  const PAYLOAD_MAX_NODES = Math.max(50, Math.min(20_000, Number(env.PAYLOAD_MAX_NODES || 600)));
  const PAYLOAD_MAX_ARRAY_LENGTH = Math.max(10, Math.min(5000, Number(env.PAYLOAD_MAX_ARRAY_LENGTH || 250)));
  const PAYLOAD_MAX_OBJECT_KEYS = Math.max(10, Math.min(5000, Number(env.PAYLOAD_MAX_OBJECT_KEYS || 250)));
  const PAYLOAD_MAX_STRING_LENGTH = Math.max(128, Math.min(200_000, Number(env.PAYLOAD_MAX_STRING_LENGTH || 8192)));
  const PAYLOAD_MAX_KEY_LENGTH = Math.max(16, Math.min(512, Number(env.PAYLOAD_MAX_KEY_LENGTH || 96)));
  const TELEMETRY_BURST_WINDOW_MS = Math.max(1000, Math.min(60_000, Number(env.ADMIN_TELEMETRY_BURST_WINDOW_MS || 10_000)));
  const TELEMETRY_BURST_MAX = Math.max(1, Math.min(100, Number(env.ADMIN_TELEMETRY_BURST_MAX || 4)));
  const ACCESS_COOKIE_NAME = 'flight_access_token';
  const REFRESH_COOKIE_NAME = 'flight_refresh_token';
  const OAUTH_BINDING_COOKIE_NAME = 'flight_oauth_bind';
  const ACCESS_COOKIE_TTL_MS = 15 * 60 * 1000;
  const REFRESH_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const AUTH_COOKIE_DOMAIN = String(env.AUTH_COOKIE_DOMAIN || '').trim() || null;
  const DEFAULT_CORS_ALLOWLIST = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'];
  const DERIVED_FRONTEND_ORIGIN = normalizeOriginValue(env.FRONTEND_ORIGIN || FRONTEND_URL);
  const ENV_CORS_ALLOWLIST = [
    ...splitCsvValues(env.CORS_ORIGIN),
    ...splitCsvValues(env.FRONTEND_ORIGIN),
    ...splitCsvValues(env.CORS_ALLOWLIST),
    DERIVED_FRONTEND_ORIGIN
  ]
    .map((entry) => normalizeOriginValue(entry))
    .filter(Boolean);
  const CORS_ALLOWLIST = new Set(ENV_CORS_ALLOWLIST.length > 0 ? ENV_CORS_ALLOWLIST : NODE_ENV === 'production' ? [] : DEFAULT_CORS_ALLOWLIST);
  const ADMIN_ALLOWLIST_EMAILS = new Set(
    [env.ADMIN_ALLOWLIST_EMAILS, env.BACKOFFICE_ADMIN_EMAILS]
      .filter((value) => String(value || '').trim().length > 0)
      .join(',')
      .split(',')
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean)
  );
  if (ADMIN_ALLOWLIST_EMAILS.size === 0 && NODE_ENV !== 'production') {
    logger.warn('ADMIN_ALLOWLIST_EMAILS not configured - admin endpoints will be inaccessible. Set ADMIN_ALLOWLIST_EMAILS or BACKOFFICE_ADMIN_EMAILS.');
  }
  const ADMIN_DASHBOARD_ENABLED = String(env.ADMIN_DASHBOARD_ENABLED || 'true').trim().toLowerCase() !== 'false';
  const RATE_LIMIT_WINDOW_MS = Number(env.RATE_LIMIT_WINDOW || 60_000);
  const RATE_LIMIT_MAX = Number(env.RATE_LIMIT_MAX || env.RL_API_PER_MINUTE || 120);
  const RL_AUTH_PER_MINUTE = Number(env.RL_AUTH_PER_MINUTE || 15);
  const RL_OUTBOUND_PER_MINUTE = Math.max(10, Number(env.RL_OUTBOUND_PER_MINUTE || 120));
  const RL_OUTBOUND_PER_SECOND = Math.max(1, Number(env.RL_OUTBOUND_PER_SECOND || 10));
  const RL_TELEMETRY_PER_SECOND = Math.max(1, Number(env.RL_TELEMETRY_PER_SECOND || 10));
  const AUTH_REQUIRE_TRUSTED_ORIGIN =
    String(env.AUTH_REQUIRE_TRUSTED_ORIGIN || (NODE_ENV === 'production' ? 'true' : 'false'))
      .trim()
      .toLowerCase() !== 'false';
  const AUTH_RETURN_ACCESS_TOKEN =
    String(env.AUTH_RETURN_ACCESS_TOKEN || (NODE_ENV === 'production' ? 'false' : 'true'))
      .trim()
      .toLowerCase() === 'true';
  const REGISTRATION_ENABLED = String(env.AUTH_REGISTRATION_ENABLED || env.REGISTRATION_ENABLED || 'true').trim().toLowerCase() !== 'false';
  const LEGACY_AUTH_ROUTES_ENABLED = parseFlag(env.LEGACY_AUTH_ROUTES_ENABLED, NODE_ENV !== 'production');
  const MOCK_BILLING_UPGRADES_ENABLED = parseFlag(env.ALLOW_MOCK_BILLING_UPGRADES, NODE_ENV !== 'production');
  const RUNTIME_MODE_RAW = String(env.RUNTIME_MODE || 'all').trim().toLowerCase();
  const RUNTIME_MODE = new Set(['all', 'api', 'worker']).has(RUNTIME_MODE_RAW) ? RUNTIME_MODE_RAW : 'all';
  if (RUNTIME_MODE !== RUNTIME_MODE_RAW) {
    logger.warn({ runtimeMode: RUNTIME_MODE_RAW, fallback: RUNTIME_MODE }, 'runtime_mode_invalid_fallback_to_all');
  }
  const RUN_STARTUP_TASKS = String(env.RUN_STARTUP_TASKS || 'true').trim().toLowerCase() === 'true';
  const CRON_RETRY_ATTEMPTS = Math.max(0, Number(env.CRON_RETRY_ATTEMPTS || 1));
  const CRON_RETRY_DELAY_MS = Math.max(0, Number(env.CRON_RETRY_DELAY_MS || 1500));
  const SUBSCRIPTION_SCAN_CACHE_TTL_SEC = Math.max(60, Number(env.SUBSCRIPTION_SCAN_CACHE_TTL_SEC || 900));
  const SUBSCRIPTION_SCAN_LOCK_TTL_SEC = Math.max(30, Number(env.SUBSCRIPTION_SCAN_LOCK_TTL_SEC || 300));
  const SHUTDOWN_TIMEOUT_MS = Math.max(1_000, Number(env.SHUTDOWN_TIMEOUT_MS || 12_000));
  const ALLOW_INSECURE_STARTUP_FOR_TESTS = String(env.ALLOW_INSECURE_STARTUP_FOR_TESTS || 'false').trim().toLowerCase() === 'true';
  const ALLOW_INSECURE_STARTUP_IN_PRODUCTION = String(env.ALLOW_INSECURE_STARTUP_IN_PRODUCTION || 'false').trim().toLowerCase() === 'true';
  const INSECURE_STARTUP_BYPASS_ENABLED = ALLOW_INSECURE_STARTUP_FOR_TESTS && ALLOW_INSECURE_STARTUP_IN_PRODUCTION;
  const REQUIRE_PRIMARY_INFRA_IN_PRODUCTION = String(env.REQUIRE_PRIMARY_INFRA_IN_PRODUCTION || 'true').trim().toLowerCase() !== 'false';
  const PRIMARY_INFRA_CHECK_TIMEOUT_MS = Math.max(1_000, Number(env.PRIMARY_INFRA_CHECK_TIMEOUT_MS || 5000));
  const LOGIN_DUMMY_PASSWORD_HASH =
    '$2b$10$7EqJtq98hPqEX7fNZaFWoOHiA6fQh6J1M4nA4sIY5Pja/qvpDMAYA';
  const TRUST_PROXY_RAW = String(env.TRUST_PROXY || '').trim().toLowerCase();
  const TRUST_PROXY = resolveTrustProxyValue({ trustProxyRaw: TRUST_PROXY_RAW, nodeEnv: NODE_ENV });

  if (NODE_ENV === 'production' && MOCK_BILLING_UPGRADES_ENABLED) {
    logger.fatal(
      {
        envKey: 'ALLOW_MOCK_BILLING_UPGRADES',
        hint: 'Disable mock billing upgrade routes in production.'
      },
      'startup_blocked_insecure_mock_billing_flag'
    );
    throw new Error('startup_blocked_insecure_mock_billing_flag');
  }

  if (NODE_ENV === 'production' && CORS_ALLOWLIST.size === 0) {
    if (!INSECURE_STARTUP_BYPASS_ENABLED) {
      logger.fatal(
        {
          corsOriginsConfigured: CORS_ALLOWLIST.size,
          hint: 'Set CORS_ALLOWLIST, CORS_ORIGIN or FRONTEND_ORIGIN.'
        },
        'startup_blocked_missing_cors_allowlist'
      );
      throw new Error('startup_blocked_missing_cors_allowlist');
    }
    logger.warn(
      {
        corsOriginsConfigured: CORS_ALLOWLIST.size,
        hint: 'Production CORS allowlist is empty. Startup bypass flag allowed this process to continue.'
      },
      'startup_insecure_empty_cors_allowlist'
    );
  }

  return {
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
    PROVIDER_COLLECTION_EFFECTIVE_ENABLED,
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
  };
}
