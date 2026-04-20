import { createHash } from 'node:crypto';
import { logger } from './logger.js';

const COST_TABLE = {
  // OpenAI
  'gpt-4.1-mini': { input: 0.4 / 1_000_000, output: 1.6 / 1_000_000 },
  'gpt-4.1': { input: 2 / 1_000_000, output: 8 / 1_000_000 },
  'gpt-4o': { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
  'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  'gpt-3.5-turbo': { input: 0.5 / 1_000_000, output: 1.5 / 1_000_000 },
  // Anthropic
  'claude-3-5-sonnet-20241022': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-3-5-haiku-20241022': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
  'claude-3-haiku-20240307': { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
  'claude-3-opus-20240229': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-opus-4-6': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-haiku-4-5-20251001': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 }
};

const CACHE_ENVELOPE_VERSION = 1;
const inFlight = new Map();

const aiCacheMetrics = {
  hits: 0,
  misses: 0,
  inflightDeduped: 0,
  distributedLockAcquired: 0,
  distributedLockJoined: 0,
  distributedLockWaitHits: 0,
  distributedLockTimeouts: 0,
  distributedLockReleaseErrors: 0,
  cacheWrites: 0,
  cacheBypasses: 0,
  cacheReadErrors: 0,
  cacheWriteErrors: 0,
  liveCalls: 0,
  estimatedLiveCostEur: 0,
  estimatedSavedCostEur: 0,
  callsByProvider: {},
  callsByModel: {},
  callsByRoute: {},
  lastEventAt: null
};

function nowIso() {
  return new Date().toISOString();
}

function round6(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function toFinite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePromptLikeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function canonicalizeValue(value, { semantic = false, maxStringLength = 4000 } = {}) {
  if (value == null) return value;
  if (typeof value === 'string') {
    const text = semantic ? normalizePromptLikeText(value) : String(value);
    return text.slice(0, maxStringLength);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => canonicalizeValue(item, { semantic, maxStringLength }));
  if (typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      const next = canonicalizeValue(value[key], { semantic, maxStringLength });
      if (next === undefined) continue;
      out[key] = next;
    }
    return out;
  }
  return String(value);
}

function stableStringify(value) {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  const body = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',');
  return `{${body}}`;
}

function buildCacheKey(namespace, input, { semantic = false, inputNormalizer } = {}) {
  const normalizedInput = typeof inputNormalizer === 'function' ? inputNormalizer(input) : input;
  const canonical = canonicalizeValue(normalizedInput, { semantic });
  const fingerprint = createHash('sha256').update(stableStringify(canonical)).digest('hex').slice(0, 40);
  return `ai:cache:v2:${String(namespace || 'default')}:${fingerprint}`;
}

function readUsageTokens(usage) {
  const inputTokens = toFinite(usage?.input_tokens ?? usage?.prompt_tokens, 0);
  const outputTokens = toFinite(usage?.output_tokens ?? usage?.completion_tokens, 0);
  return {
    inputTokens: Math.max(0, Math.round(inputTokens)),
    outputTokens: Math.max(0, Math.round(outputTokens))
  };
}

export function estimateCostEur(usage, model) {
  const safeModel = String(model || '').trim().toLowerCase();
  if (!safeModel) return 0;
  const rates = COST_TABLE[safeModel];
  if (!rates) return 0;
  const tokens = readUsageTokens(usage);
  return round6(tokens.inputTokens * rates.input + tokens.outputTokens * rates.output);
}

function bumpCounter(mapObject, key) {
  const safeKey = String(key || 'unknown').trim().toLowerCase() || 'unknown';
  mapObject[safeKey] = Number(mapObject[safeKey] || 0) + 1;
}

function markMetricEvent() {
  aiCacheMetrics.lastEventAt = nowIso();
}

function readFlag(value, fallback = true) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['true', '1', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  return fallback;
}

function isCacheEnabled() {
  return readFlag(process.env.AI_CACHE_ENABLED, true);
}

function isDistributedDedupeEnabled() {
  return readFlag(process.env.AI_CACHE_DISTRIBUTED_DEDUPE_ENABLED, true);
}

function sleep(ms) {
  const waitMs = Math.max(1, Number(ms) || 1);
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

export function getAiCacheMetrics() {
  return {
    ...aiCacheMetrics,
    inFlight: inFlight.size
  };
}

export function resetAiCacheMetrics() {
  aiCacheMetrics.hits = 0;
  aiCacheMetrics.misses = 0;
  aiCacheMetrics.inflightDeduped = 0;
  aiCacheMetrics.distributedLockAcquired = 0;
  aiCacheMetrics.distributedLockJoined = 0;
  aiCacheMetrics.distributedLockWaitHits = 0;
  aiCacheMetrics.distributedLockTimeouts = 0;
  aiCacheMetrics.distributedLockReleaseErrors = 0;
  aiCacheMetrics.cacheWrites = 0;
  aiCacheMetrics.cacheBypasses = 0;
  aiCacheMetrics.cacheReadErrors = 0;
  aiCacheMetrics.cacheWriteErrors = 0;
  aiCacheMetrics.liveCalls = 0;
  aiCacheMetrics.estimatedLiveCostEur = 0;
  aiCacheMetrics.estimatedSavedCostEur = 0;
  aiCacheMetrics.callsByProvider = {};
  aiCacheMetrics.callsByModel = {};
  aiCacheMetrics.callsByRoute = {};
  aiCacheMetrics.lastEventAt = null;
}

function createMemoryCache(maxEntries) {
  const store = new Map();
  return {
    get(key) {
      const row = store.get(key);
      if (!row) return null;
      if (row.expiresAtMs <= Date.now()) {
        store.delete(key);
        return null;
      }
      return row.value;
    },
    set(key, ttlSeconds, value) {
      if (store.size >= maxEntries) {
        const firstKey = store.keys().next().value;
        if (firstKey) store.delete(firstKey);
      }
      store.set(key, { value, expiresAtMs: Date.now() + Math.max(1, ttlSeconds) * 1000 });
    }
  };
}

function isEnvelope(value) {
  return Boolean(value && typeof value === 'object' && value.__aiCacheEnvelope === CACHE_ENVELOPE_VERSION);
}

function safeParseJson(raw) {
  try {
    return JSON.parse(String(raw || 'null'));
  } catch {
    return null;
  }
}

/**
 * @param {{ cacheClient?: object|null, defaultTtlSeconds?: number }} options
 */
export function createAiCache({ cacheClient = null, defaultTtlSeconds = 3600 } = {}) {
  const fallbackMaxEntries = Math.max(64, Math.min(10_000, Number(process.env.AI_CACHE_MEMORY_MAX_ENTRIES || 512)));
  const memory = createMemoryCache(fallbackMaxEntries);

  async function cacheGet(key) {
    if (cacheClient && typeof cacheClient.get === 'function') {
      try {
        const raw = await cacheClient.get(key);
        if (!raw) return null;
        return safeParseJson(raw);
      } catch (error) {
        aiCacheMetrics.cacheReadErrors += 1;
        markMetricEvent();
        logger.warn({ err: error?.message || String(error), key }, 'ai_cache_read_failed');
        return null;
      }
    }
    return memory.get(key);
  }

  async function cacheSet(key, ttlSeconds, value) {
    if (cacheClient && typeof cacheClient.setex === 'function') {
      try {
        await cacheClient.setex(key, Math.max(1, Number(ttlSeconds) || 1), JSON.stringify(value));
        return true;
      } catch (error) {
        aiCacheMetrics.cacheWriteErrors += 1;
        markMetricEvent();
        logger.warn({ err: error?.message || String(error), key, ttlSeconds }, 'ai_cache_write_failed');
        return false;
      }
    }
    memory.set(key, ttlSeconds, value);
    return true;
  }

  /**
   * @template T
   * @param {string} namespace
   * @param {unknown} input
   * @param {() => Promise<{ value: T, usage?: object|null, model?: string|null } | T>} factory
   * @param {{
   *   ttlSeconds?: number,
   *   provider?: string,
   *   route?: string,
   *   semantic?: boolean,
   *   inputNormalizer?: (input: unknown) => unknown,
   *   allowLiveCall?: boolean,
   *   onCacheEvent?: (event: object) => void
   * }} [options]
   * @returns {Promise<T|null>}
   */
  async function withCache(namespace, input, factory, options = {}) {
    const ttl = Math.max(15, Number(options.ttlSeconds ?? defaultTtlSeconds) || 3600);
    const provider = String(options.provider || 'unknown').trim().toLowerCase() || 'unknown';
    const route = String(options.route || namespace || 'unknown').trim().toLowerCase() || 'unknown';
    const cacheEnabled = isCacheEnabled();
    const allowLiveCall = options.allowLiveCall !== false;
    const distributedDedupeEnabled = options.distributedDedupe !== false && isDistributedDedupeEnabled();
    const cacheKey = buildCacheKey(namespace, input, {
      semantic: options.semantic !== false,
      inputNormalizer: options.inputNormalizer
    });

    const emitEvent = (event) => {
      if (typeof options.onCacheEvent === 'function') {
        try {
          options.onCacheEvent(event);
        } catch {}
      }
    };

    if (cacheEnabled) {
      const cached = await cacheGet(cacheKey);
      if (cached !== null && cached !== undefined) {
        aiCacheMetrics.hits += 1;
        bumpCounter(aiCacheMetrics.callsByProvider, provider);
        bumpCounter(aiCacheMetrics.callsByRoute, route);
        if (isEnvelope(cached)) {
          const model = String(cached?.meta?.model || '').trim().toLowerCase();
          if (model) bumpCounter(aiCacheMetrics.callsByModel, model);
          aiCacheMetrics.estimatedSavedCostEur = round6(
            aiCacheMetrics.estimatedSavedCostEur + toFinite(cached?.meta?.estimatedCostEur, 0)
          );
          markMetricEvent();
          logger.info({ namespace, provider, route, cacheKey }, 'ai_cache_hit');
          emitEvent({ type: 'hit', namespace, provider, route, cacheKey, model });
          return cached.value ?? null;
        }

        markMetricEvent();
        logger.info({ namespace, provider, route, cacheKey }, 'ai_cache_hit_legacy');
        emitEvent({ type: 'hit', namespace, provider, route, cacheKey, model: null });
        return cached;
      }
    }

    if (inFlight.has(cacheKey)) {
      aiCacheMetrics.inflightDeduped += 1;
      markMetricEvent();
      logger.info({ namespace, provider, route, cacheKey }, 'ai_cache_inflight_deduped');
      emitEvent({ type: 'inflight_deduped', namespace, provider, route, cacheKey });
      return inFlight.get(cacheKey);
    }

    let acquiredDistributedLock = false;
    let distributedLockKey = null;
    const canUseDistributedLock =
      distributedDedupeEnabled &&
      cacheEnabled &&
      Boolean(cacheClient) &&
      typeof cacheClient.setnx === 'function' &&
      typeof cacheClient.get === 'function';

    if (canUseDistributedLock) {
      distributedLockKey = `${cacheKey}:lock`;
      const lockTtlSec = Math.max(2, Number(process.env.AI_CACHE_DISTRIBUTED_LOCK_TTL_SECONDS || 15));
      const lockWaitMs = Math.max(50, Number(process.env.AI_CACHE_DISTRIBUTED_WAIT_MS || 2500));
      const lockPollMs = Math.max(20, Number(process.env.AI_CACHE_DISTRIBUTED_POLL_MS || 120));
      const strictDistributedWait = readFlag(process.env.AI_CACHE_DISTRIBUTED_STRICT_WAIT, false);

      try {
        const lockResult = Number(await cacheClient.setnx(distributedLockKey, String(Date.now()), lockTtlSec)) === 1;
        if (lockResult) {
          acquiredDistributedLock = true;
          aiCacheMetrics.distributedLockAcquired += 1;
          markMetricEvent();
        } else {
          aiCacheMetrics.distributedLockJoined += 1;
          markMetricEvent();
          const deadline = Date.now() + lockWaitMs;
          while (Date.now() < deadline) {
            await sleep(lockPollMs);
            const waitedCached = await cacheGet(cacheKey);
            if (waitedCached !== null && waitedCached !== undefined) {
              aiCacheMetrics.distributedLockWaitHits += 1;
              aiCacheMetrics.hits += 1;
              bumpCounter(aiCacheMetrics.callsByProvider, provider);
              bumpCounter(aiCacheMetrics.callsByRoute, route);
              markMetricEvent();
              if (isEnvelope(waitedCached)) {
                const model = String(waitedCached?.meta?.model || '').trim().toLowerCase();
                if (model) bumpCounter(aiCacheMetrics.callsByModel, model);
                aiCacheMetrics.estimatedSavedCostEur = round6(
                  aiCacheMetrics.estimatedSavedCostEur + toFinite(waitedCached?.meta?.estimatedCostEur, 0)
                );
                logger.info({ namespace, provider, route, cacheKey }, 'ai_cache_distributed_wait_hit');
                emitEvent({ type: 'hit', namespace, provider, route, cacheKey, model });
                return waitedCached.value ?? null;
              }
              logger.info({ namespace, provider, route, cacheKey }, 'ai_cache_distributed_wait_hit_legacy');
              emitEvent({ type: 'hit', namespace, provider, route, cacheKey, model: null });
              return waitedCached;
            }
          }
          aiCacheMetrics.distributedLockTimeouts += 1;
          markMetricEvent();
          logger.warn({ namespace, provider, route, cacheKey }, 'ai_cache_distributed_wait_timeout');
          if (strictDistributedWait) {
            aiCacheMetrics.cacheBypasses += 1;
            markMetricEvent();
            emitEvent({ type: 'miss_bypassed', namespace, provider, route, cacheKey, reason: 'distributed_wait_timeout' });
            return null;
          }
        }
      } catch (error) {
        logger.warn({ err: error?.message || String(error), cacheKey }, 'ai_cache_distributed_lock_failed');
      }
    }

    if (!allowLiveCall) {
      aiCacheMetrics.cacheBypasses += 1;
      markMetricEvent();
      logger.info({ namespace, provider, route, cacheKey }, 'ai_cache_miss_bypassed_live_call');
      emitEvent({ type: 'miss_bypassed', namespace, provider, route, cacheKey });
      return null;
    }

    aiCacheMetrics.misses += 1;
    aiCacheMetrics.liveCalls += 1;
    bumpCounter(aiCacheMetrics.callsByProvider, provider);
    bumpCounter(aiCacheMetrics.callsByRoute, route);
    markMetricEvent();

    const startedAt = Date.now();
    const pending = (async () => {
      try {
        const factoryOut = await factory();
        const normalizedFactoryOut =
          factoryOut && typeof factoryOut === 'object' && Object.prototype.hasOwnProperty.call(factoryOut, 'value')
            ? factoryOut
            : { value: factoryOut, usage: null, model: null };

        const model = String(normalizedFactoryOut?.model || '').trim().toLowerCase();
        if (model) bumpCounter(aiCacheMetrics.callsByModel, model);

        const estimatedCostEur = estimateCostEur(normalizedFactoryOut?.usage || null, normalizedFactoryOut?.model || '');
        aiCacheMetrics.estimatedLiveCostEur = round6(aiCacheMetrics.estimatedLiveCostEur + estimatedCostEur);
        markMetricEvent();

        const envelope = {
          __aiCacheEnvelope: CACHE_ENVELOPE_VERSION,
          value: normalizedFactoryOut?.value ?? null,
          meta: {
            namespace,
            route,
            provider,
            model: normalizedFactoryOut?.model || null,
            usage: normalizedFactoryOut?.usage || null,
            estimatedCostEur,
            cachedAt: nowIso()
          }
        };

        if (cacheEnabled && envelope.value !== null && envelope.value !== undefined) {
          const wrote = await cacheSet(cacheKey, ttl, envelope);
          if (wrote) {
            aiCacheMetrics.cacheWrites += 1;
            markMetricEvent();
          }
        }

        logger.info(
          {
            namespace,
            provider,
            route,
            model: envelope.meta.model,
            durationMs: Date.now() - startedAt,
            estimatedCostEur,
            cacheKey
          },
          'ai_cache_miss_completed'
        );
        emitEvent({
          type: 'miss_completed',
          namespace,
          provider,
          route,
          model: envelope.meta.model,
          cacheKey,
          estimatedCostEur
        });
        return envelope.value;
      } finally {
        inFlight.delete(cacheKey);
        if (acquiredDistributedLock && distributedLockKey && typeof cacheClient?.del === 'function') {
          try {
            await cacheClient.del(distributedLockKey);
          } catch (error) {
            aiCacheMetrics.distributedLockReleaseErrors += 1;
            markMetricEvent();
            logger.warn({ err: error?.message || String(error), distributedLockKey }, 'ai_cache_distributed_lock_release_failed');
          }
        }
      }
    })();

    inFlight.set(cacheKey, pending);
    return pending;
  }

  return {
    withCache
  };
}
