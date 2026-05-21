import { parseFlag } from './env-flags.js';

export const RUNTIME_PROFILES = ['soft-zero-cost', 'paid-live', 'production-full'];
export const CACHE_BACKENDS = ['redis', 'memory', 'postgres'];

function normalizeProfile(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return RUNTIME_PROFILES.includes(normalized) ? normalized : null;
}

function normalizeCacheBackend(value, hasRedisUrl) {
  const normalized = String(value || '').trim().toLowerCase();
  if (CACHE_BACKENDS.includes(normalized)) return normalized;
  return hasRedisUrl ? 'redis' : 'memory';
}

function normalizeRedisRequiredMode(value, profile) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['production_full', 'soft_optional'].includes(normalized)) return normalized;
  return profile === 'soft-zero-cost' ? 'soft_optional' : 'production_full';
}

function readPositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function isSingleInstance(env = process.env) {
  const instanceCount = readPositiveInt(env.RUNTIME_INSTANCE_COUNT || env.WEB_CONCURRENCY || env.INSTANCE_COUNT, 1);
  const runtimeMode = String(env.RUNTIME_MODE || 'all').trim().toLowerCase();
  const clusterEnabled = parseFlag(env.CLUSTER_MODE_ENABLED, false);
  return instanceCount <= 1 && runtimeMode !== 'worker' && !clusterEnabled;
}

function aiFreeDisabled(env = process.env) {
  return !parseFlag(env.FREE_AI_ENABLED, false) && !parseFlag(env.AI_ALLOW_FREE_USERS, false);
}

function freeLiveProviderDisabled(env = process.env) {
  return !parseFlag(env.FREE_LIVE_PROVIDER_ENABLED, false) && !parseFlag(env.FREE_PROVIDER_LIVE_ENABLED, false);
}

function freeCostJobsDisabled(env = process.env) {
  return !parseFlag(env.FREE_DEEP_SCAN_ENABLED, false) &&
    !parseFlag(env.FREE_PER_USER_JOBS_ENABLED, false) &&
    !parseFlag(env.FREE_INSTANT_ALERTS_ENABLED, false);
}

function budgetGuardsFailClosed(env = process.env) {
  return !parseFlag(env.AI_BUDGET_FAIL_OPEN, false) && !parseFlag(env.SEARCH_PROVIDER_BUDGET_FAIL_OPEN, false);
}

function liveProviderOrJobsEnabled(env = process.env) {
  return parseFlag(env.ENABLE_PROVIDER_DUFFEL, false) ||
    parseFlag(env.ENABLE_PROVIDER_KIWI, false) ||
    parseFlag(env.FLIGHT_SCAN_ENABLED, false) ||
    parseFlag(env.PROVIDER_COLLECTION_ENABLED, false);
}

function paidFeaturesEnabled(env = process.env) {
  return liveProviderOrJobsEnabled(env) ||
    parseFlag(env.AI_ROUTE_DECISION_ENABLED, true) ||
    parseFlag(env.AI_ROUTE_INTENT_ENABLED, true) ||
    Boolean(String(env.STRIPE_SECRET_KEY || '').trim());
}

export function resolveRuntimeProfile(env = process.env) {
  const explicit = normalizeProfile(env.RUNTIME_PROFILE);
  if (explicit) return explicit;

  const launchMode = String(env.LAUNCH_MODE || '').trim().toLowerCase();
  if (launchMode === 'soft') return 'soft-zero-cost';

  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') return 'production-full';
  return 'soft-zero-cost';
}

export function getRuntimeProfileConfig(env = process.env) {
  const runtimeProfile = resolveRuntimeProfile(env);
  const hasRedisUrl = Boolean(String(env.REDIS_URL || '').trim());
  const cacheBackend = normalizeCacheBackend(env.CACHE_BACKEND, hasRedisUrl);
  const redisRequiredMode = normalizeRedisRequiredMode(env.REDIS_REQUIRED_MODE, runtimeProfile);
  const singleInstance = isSingleInstance(env);
  const allowInMemorySoftLaunch = parseFlag(env.ALLOW_IN_MEMORY_CACHE_IN_SOFT_LAUNCH, runtimeProfile === 'soft-zero-cost');
  const freeZeroCostSafe = aiFreeDisabled(env) && freeLiveProviderDisabled(env) && freeCostJobsDisabled(env);
  const failClosed = budgetGuardsFailClosed(env);
  const liveOrJobs = liveProviderOrJobsEnabled(env);
  const paidLive = runtimeProfile === 'paid-live' || liveOrJobs;

  return {
    runtimeProfile,
    cacheBackend,
    redisRequiredMode,
    singleInstance,
    allowInMemorySoftLaunch,
    freeZeroCostSafe,
    budgetGuardsFailClosed: failClosed,
    liveProviderOrJobsEnabled: liveOrJobs,
    paidFeaturesEnabled: paidFeaturesEnabled(env),
    redisConfigured: hasRedisUrl,
    postgresConfigured: Boolean(String(env.DATABASE_URL || '').trim())
  };
}

export function evaluateCachePolicy(env = process.env) {
  const config = getRuntimeProfileConfig(env);
  const reasons = [];

  if (config.cacheBackend === 'postgres') {
    reasons.push('postgres_cache_backend_not_implemented');
    return {
      ...config,
      ok: false,
      redisRequired: config.runtimeProfile !== 'soft-zero-cost',
      memoryAllowed: false,
      redisStatus: config.redisConfigured ? 'configured' : 'missing',
      status: 'invalid',
      reasons
    };
  }

  const redisRequired =
    config.runtimeProfile === 'production-full' ||
    config.redisRequiredMode === 'production_full' ||
    config.cacheBackend === 'redis' ||
    (config.runtimeProfile === 'paid-live' && config.liveProviderOrJobsEnabled);

  const memoryAllowed =
    config.runtimeProfile === 'soft-zero-cost' &&
    config.cacheBackend === 'memory' &&
    config.allowInMemorySoftLaunch &&
    config.singleInstance &&
    config.freeZeroCostSafe &&
    config.budgetGuardsFailClosed &&
    !config.liveProviderOrJobsEnabled;

  if (config.cacheBackend === 'memory' && !memoryAllowed) {
    if (config.runtimeProfile !== 'soft-zero-cost') reasons.push('memory_cache_profile_not_allowed');
    if (!config.allowInMemorySoftLaunch) reasons.push('memory_cache_soft_launch_not_allowed');
    if (!config.singleInstance) reasons.push('memory_cache_requires_single_instance');
    if (!config.freeZeroCostSafe) reasons.push('free_zero_cost_guards_not_satisfied');
    if (!config.budgetGuardsFailClosed) reasons.push('budget_guards_must_fail_closed');
    if (config.liveProviderOrJobsEnabled) reasons.push('live_provider_or_jobs_require_redis');
  }

  if (redisRequired && !config.redisConfigured) reasons.push('redis_required_missing');
  if (config.cacheBackend === 'redis' && !config.redisConfigured) reasons.push('redis_backend_missing_url');

  const ok = (config.redisConfigured && config.cacheBackend === 'redis') ||
    (config.cacheBackend === 'memory' && memoryAllowed) ||
    (!redisRequired && config.cacheBackend !== 'redis');

  let redisStatus = 'not_required';
  if (config.redisConfigured) redisStatus = 'configured';
  else if (memoryAllowed) redisStatus = 'optional_missing_safe';
  else if (redisRequired) redisStatus = 'required_missing';
  else redisStatus = 'optional_missing';

  return {
    ...config,
    ok,
    redisRequired,
    memoryAllowed,
    redisStatus,
    status: ok ? 'ok' : 'blocked',
    reasons
  };
}

export function getRuntimeProfileSummary(env = process.env) {
  const cache = evaluateCachePolicy(env);
  return {
    runtimeProfile: cache.runtimeProfile,
    cacheBackend: cache.cacheBackend,
    redisStatus: cache.redisStatus,
    redisRequired: cache.redisRequired,
    singleInstance: cache.singleInstance,
    freeCostStatus: cache.freeZeroCostSafe ? 'zero_cost_confirmed' : 'zero_cost_at_risk',
    ai: aiFreeDisabled(env) ? 'paid_only' : 'free_risk',
    providerLive: freeLiveProviderDisabled(env) ? 'gated' : 'free_risk',
    billing: String(env.STRIPE_SECRET_KEY || '').trim() ? 'configured' : 'gated',
    email: parseFlag(env.EMAIL_DRY_RUN, true) ? 'dry_run' : 'live_or_required',
    cachePolicyOk: cache.ok,
    cachePolicyReasons: cache.reasons
  };
}
