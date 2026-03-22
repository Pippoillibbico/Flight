import Redis from 'ioredis';
import { logger } from './logger.js';

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function parseListSafe(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

class InMemoryCache {
  constructor() {
    this.store = new Map();
  }

  _getEntry(key) {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt && hit.expiresAt <= nowSec()) {
      this.store.delete(key);
      return null;
    }
    return hit;
  }

  async get(key) {
    const hit = this._getEntry(key);
    return hit ? hit.value : null;
  }

  async setex(key, ttlSec, value) {
    this.store.set(key, { value: String(value), expiresAt: nowSec() + Number(ttlSec || 0) });
    return 'OK';
  }

  async setnx(key, value, ttlSec) {
    const hit = this._getEntry(key);
    if (hit) return 0;
    this.store.set(key, { value: String(value), expiresAt: nowSec() + Number(ttlSec || 0) });
    return 1;
  }

  async incr(key) {
    const hit = this._getEntry(key);
    const next = (hit ? Number(hit.value || 0) : 0) + 1;
    this.store.set(key, { value: String(next), expiresAt: hit?.expiresAt || null });
    return next;
  }

  async expire(key, ttlSec) {
    const hit = this._getEntry(key);
    if (!hit) return 0;
    this.store.set(key, { value: hit.value, expiresAt: nowSec() + Number(ttlSec || 0) });
    return 1;
  }

  async del(key) {
    return this.store.delete(key) ? 1 : 0;
  }

  async lpush(key, value) {
    const hit = this._getEntry(key);
    const arr = parseListSafe(hit?.value);
    arr.unshift(value);
    this.store.set(key, { value: JSON.stringify(arr), expiresAt: hit?.expiresAt || null });
    return arr.length;
  }

  async rpop(key) {
    const hit = this._getEntry(key);
    if (!hit) return null;
    const arr = parseListSafe(hit.value);
    const value = arr.pop() ?? null;
    this.store.set(key, { value: JSON.stringify(arr), expiresAt: hit.expiresAt || null });
    return value;
  }

  async llen(key) {
    const hit = this._getEntry(key);
    if (!hit) return 0;
    return parseListSafe(hit.value).length;
  }

  async lrange(key, start, stop) {
    const hit = this._getEntry(key);
    if (!hit) return [];
    const list = parseListSafe(hit.value);
    const len = list.length;
    if (len === 0) return [];

    const from = Number(start);
    const to = Number(stop);
    const startIndex = from >= 0 ? from : len + from;
    const stopIndex = to >= 0 ? to : len + to;

    const safeStart = Math.max(0, startIndex);
    const safeStop = Math.min(len - 1, stopIndex);
    if (safeStart > safeStop) return [];
    return list.slice(safeStart, safeStop + 1);
  }

  async ltrim(key, start, stop) {
    const hit = this._getEntry(key);
    if (!hit) return 'OK';
    const list = parseListSafe(hit.value);
    const len = list.length;
    if (len === 0) {
      this.store.set(key, { value: JSON.stringify([]), expiresAt: hit.expiresAt || null });
      return 'OK';
    }

    const from = Number(start);
    const to = Number(stop);
    const startIndex = from >= 0 ? from : len + from;
    const stopIndex = to >= 0 ? to : len + to;
    const safeStart = Math.max(0, startIndex);
    const safeStop = Math.min(len - 1, stopIndex);

    const trimmed = safeStart <= safeStop ? list.slice(safeStart, safeStop + 1) : [];
    this.store.set(key, { value: JSON.stringify(trimmed), expiresAt: hit.expiresAt || null });
    return 'OK';
  }

  async ping() {
    return 'PONG';
  }
}

class HybridCache {
  constructor(redisClient) {
    this.redisClient = redisClient || null;
    this.memory = new InMemoryCache();
    this.redisDegraded = false;
  }

  _markDegraded(error, command) {
    if (this.redisDegraded) return;
    this.redisDegraded = true;
    logger.warn({ err: error, command }, 'free_cache_redis_degraded_using_memory_fallback');
  }

  async _withFallback(command, redisFn, memoryFn) {
    if (!this.redisClient) return memoryFn();
    try {
      return await redisFn();
    } catch (error) {
      this._markDegraded(error, command);
      return memoryFn();
    }
  }

  async get(key) {
    return this._withFallback('get', () => this.redisClient.get(key), () => this.memory.get(key));
  }

  async setex(key, ttlSec, value) {
    return this._withFallback('setex', () => this.redisClient.setex(key, ttlSec, value), () => this.memory.setex(key, ttlSec, value));
  }

  async setnx(key, value, ttlSec) {
    return this._withFallback(
      'setnx',
      async () => {
        const out = await this.redisClient.set(key, String(value), 'EX', Number(ttlSec || 0), 'NX');
        return out === 'OK' ? 1 : 0;
      },
      () => this.memory.setnx(key, value, ttlSec)
    );
  }

  async incr(key) {
    return this._withFallback('incr', () => this.redisClient.incr(key), () => this.memory.incr(key));
  }

  async expire(key, ttlSec) {
    return this._withFallback('expire', () => this.redisClient.expire(key, ttlSec), () => this.memory.expire(key, ttlSec));
  }

  async del(key) {
    return this._withFallback('del', () => this.redisClient.del(key), () => this.memory.del(key));
  }

  async lpush(key, value) {
    return this._withFallback('lpush', () => this.redisClient.lpush(key, value), () => this.memory.lpush(key, value));
  }

  async rpop(key) {
    return this._withFallback('rpop', () => this.redisClient.rpop(key), () => this.memory.rpop(key));
  }

  async llen(key) {
    return this._withFallback('llen', () => this.redisClient.llen(key), () => this.memory.llen(key));
  }

  async lrange(key, start, stop) {
    return this._withFallback('lrange', () => this.redisClient.lrange(key, start, stop), () => this.memory.lrange(key, start, stop));
  }

  async ltrim(key, start, stop) {
    return this._withFallback('ltrim', () => this.redisClient.ltrim(key, start, stop), () => this.memory.ltrim(key, start, stop));
  }

  async ping() {
    return this._withFallback('ping', () => this.redisClient.ping(), () => this.memory.ping());
  }

  async quit() {
    if (!this.redisClient || typeof this.redisClient.quit !== 'function') return;
    await this.redisClient.quit();
  }
}

let singleton = null;

export function getCacheClient() {
  if (singleton) return singleton;
  if (process.env.REDIS_URL) {
    const redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      // Allow short startup buffering so workers don't fail before Redis is ready.
      enableOfflineQueue: true
    });
    redis.on('error', (error) => {
      logger.warn({ err: error }, 'free_cache_redis_error');
    });
    redis.connect().catch((error) => {
      logger.warn({ err: error }, 'free_cache_redis_connect_failed');
    });
    singleton = new HybridCache(redis);
    return singleton;
  }
  singleton = new InMemoryCache();
  return singleton;
}

export async function closeCacheClient() {
  if (!singleton) return;
  const client = singleton;
  singleton = null;
  if (typeof client.quit !== 'function') return;
  try {
    await client.quit();
    logger.info({}, 'free_cache_redis_closed');
  } catch (error) {
    logger.warn({ err: error }, 'free_cache_redis_close_failed');
  }
}
