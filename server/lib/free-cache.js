import Redis from 'ioredis';
import { logger } from './logger.js';

function nowSec() {
  return Math.floor(Date.now() / 1000);
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
    const arr = hit ? JSON.parse(hit.value) : [];
    arr.unshift(value);
    this.store.set(key, { value: JSON.stringify(arr), expiresAt: hit?.expiresAt || null });
    return arr.length;
  }

  async rpop(key) {
    const hit = this._getEntry(key);
    if (!hit) return null;
    const arr = JSON.parse(hit.value);
    const value = arr.pop() ?? null;
    this.store.set(key, { value: JSON.stringify(arr), expiresAt: hit.expiresAt || null });
    return value;
  }
}

let singleton = null;

export function getCacheClient() {
  if (singleton) return singleton;
  if (process.env.REDIS_URL) {
    singleton = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      // Allow short startup buffering so workers don't fail before Redis is ready.
      enableOfflineQueue: true
    });
    singleton.on('error', (error) => {
      logger.warn({ err: error }, 'free_cache_redis_error');
    });
    singleton.connect().catch((error) => {
      logger.warn({ err: error }, 'free_cache_redis_connect_failed');
    });
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
