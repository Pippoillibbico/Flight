import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { hashPassword, signAccessToken, verifyAccessToken, verifyPassword } from '../lib/auth.js';
import { getCacheClient } from '../lib/free-cache.js';
import {
  createAlert,
  countActiveAlerts,
  createUserIfNotExists,
  getDefaultFreeLimits,
  getJustGoPrecomputed,
  getUserByEmail,
  getUserById,
  listAlerts,
  deleteAlert
} from '../lib/free-foundation-store.js';
import { appendImmutableAudit } from '../lib/audit-log.js';
import { parseCookieHeader } from '../lib/http-cookies.js';

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email(),
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
  email: z.string().email(),
  password: z.string().min(8).max(72)
}).strict();

const justGoSchema = z.object({
  origin: z.string().trim().length(3),
  budget: z.number().int().min(100).max(20000),
  days: z.number().int().min(2).max(30),
  season: z.enum(['winter', 'spring', 'summer', 'autumn']),
  mood: z.enum(['relax', 'adventure', 'culture', 'nature', 'nightlife'])
}).strict();

const createAlertSchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  target_price: z.number().positive()
}).strict();

function nextUtcMidnightIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)).toISOString();
}

function nextMinuteIso() {
  return new Date((Math.floor(Date.now() / 60000) + 1) * 60000).toISOString();
}

function utcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getDeviceId(req, res) {
  const cookies = parseCookieHeader(req?.headers?.cookie);
  let id = String(cookies.free_device_id || '').trim();
  if (!id) {
    id = randomUUID();
    res.cookie('free_device_id', id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 365,
      path: '/'
    });
  }
  return id;
}

function hashIp(ip) {
  const salt = String(process.env.IP_HASH_SALT || 'free-plan-salt');
  return createHash('sha256').update(`${ip}|${salt}`).digest('hex');
}

function parseBearer(req) {
  const raw = String(req.headers.authorization || '');
  if (!raw.startsWith('Bearer ')) return null;
  return raw.slice(7).trim() || null;
}

function ensureOriginAllowed(req, res, allowlist) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  if (!allowlist.has(origin)) {
    res.status(403).json({ error: 'request_forbidden', request_id: req.id || null });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  return true;
}

function authRequired() {
  return async (req, res, next) => {
    try {
      const token = parseBearer(req);
      if (!token) return res.status(401).json({ error: 'auth_required', request_id: req.id || null });
      const payload = verifyAccessToken(token);
      const user = await getUserById(payload?.sub);
      if (!user) return res.status(401).json({ error: 'auth_invalid', request_id: req.id || null });
      req.freeUser = user;
      req.freeAuth = payload;
      return next();
    } catch {
      return res.status(401).json({ error: 'auth_invalid', request_id: req.id || null });
    }
  };
}

function limitExceeded(res, resetAt) {
  return res.status(429).json({
    error: 'rate_limited',
    reset_at: new Date(resetAt).toISOString(),
    request_id: res.req?.id || null
  });
}

async function consumeMinuteLimit(cache, key, limit) {
  const next = await cache.incr(key);
  if (next === 1) await cache.expire(key, 70);
  return next <= limit;
}

async function consumeDailyLimit(cache, key, limit) {
  const next = await cache.incr(key);
  if (next === 1) {
    const ttlSec = Math.max(60, Math.floor((new Date(nextUtcMidnightIso()).getTime() - Date.now()) / 1000));
    await cache.expire(key, ttlSec);
  }
  return next <= limit;
}

async function getDailyCount(cache, key) {
  const raw = await cache.get(key);
  return Number(raw || 0);
}

export function buildFreeFoundationRouter({ corsAllowlist, legacyAuthEnabled = false, registrationEnabled = true }) {
  const router = express.Router();
  const cache = getCacheClient();
  const limits = getDefaultFreeLimits();
  const allowlist = new Set(corsAllowlist || []);
  const legacyAuthRateLimitPerMinute = Math.max(3, Number(process.env.LEGACY_AUTH_RL_PER_MINUTE || 12));

  async function consumeLegacyAuthRateLimit(req, res) {
    const ipHash = hashIp(getClientIp(req));
    const minuteSlot = Math.floor(Date.now() / 60000);
    const allowed = await consumeMinuteLimit(cache, `free:rl:legacy-auth:${ipHash}:${minuteSlot}`, legacyAuthRateLimitPerMinute);
    if (allowed) return true;
    limitExceeded(res, nextMinuteIso());
    return false;
  }

  router.use((req, res, next) => {
    if (!ensureOriginAllowed(req, res, allowlist)) return;
    if (req.method === 'OPTIONS') return res.status(204).send();
    return next();
  });

  router.post('/auth/register', async (req, res) => {
    if (!legacyAuthEnabled) return res.status(404).json({ error: 'not_found', request_id: req.id || null });
    if (!registrationEnabled) return res.status(403).json({ error: 'registration_disabled', request_id: req.id || null });
    if (!(await consumeLegacyAuthRateLimit(req, res))) return;

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });

    const payload = parsed.data;
    const passwordHash = await hashPassword(payload.password);
    const { created, existing } = await createUserIfNotExists({
      name: payload.name,
      email: payload.email,
      passwordHash
    });

    if (existing) return res.status(409).json({ error: 'email_already_exists', request_id: req.id || null });
    const token = signAccessToken({
      sub: created.id,
      email: created.email,
      name: created.name,
      plan: 'free',
      authChannel: 'direct'
    });

    appendImmutableAudit({
      category: 'free_auth',
      type: 'register',
      success: true,
      userId: created.id,
      ipHash: hashIp(getClientIp(req))
    }).catch(() => {});

    return res.status(201).json({
      access_token: token,
      token_type: 'Bearer',
      user: { id: created.id, name: created.name, email: created.email, plan: 'free' }
    });
  });

  router.post('/auth/login', async (req, res) => {
    if (!legacyAuthEnabled) return res.status(404).json({ error: 'not_found', request_id: req.id || null });
    if (!(await consumeLegacyAuthRateLimit(req, res))) return;

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });

    const user = await getUserByEmail(parsed.data.email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

    const token = signAccessToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      plan: 'free',
      authChannel: 'direct'
    });

    appendImmutableAudit({
      category: 'free_auth',
      type: 'login',
      success: true,
      userId: user.id,
      ipHash: hashIp(getClientIp(req))
    }).catch(() => {});

    return res.json({
      access_token: token,
      token_type: 'Bearer',
      user: { id: user.id, name: user.name, email: user.email, plan: 'free' }
    });
  });

  router.post('/demo/just-go', async (req, res) => {
    const parsed = justGoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });

    const ip = hashIp(getClientIp(req));
    const deviceId = getDeviceId(req, res);
    const minuteSlot = Math.floor(Date.now() / 60000);
    const day = utcDayKey();

    const allowIp = await consumeMinuteLimit(cache, `free:rl:demo:ip:${ip}:${minuteSlot}`, limits.demo_minute_ip_limit);
    const allowDevice = await consumeMinuteLimit(cache, `free:rl:demo:device:${deviceId}:${minuteSlot}`, limits.demo_minute_device_limit);
    if (!allowIp || !allowDevice) return limitExceeded(res, nextMinuteIso());

    const dailyKey = `free:quota:demo:search:${deviceId}:${day}`;
    const dailyAllowed = await consumeDailyLimit(cache, dailyKey, limits.demo_daily_search_limit);
    if (!dailyAllowed) return limitExceeded(res, nextUtcMidnightIso());

    const body = parsed.data;
    const cacheKey = `free:justgo:demo:${body.origin}:${body.budget}:${body.days}:${body.season}:${body.mood}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const rows = await getJustGoPrecomputed(body);
    const payload = {
      mode: 'demo',
      source: 'precomputed',
      ai_included: false,
      ai_message: 'AI not included in free plan.',
      items: rows
    };
    await cache.setex(cacheKey, 1800, JSON.stringify(payload));
    return res.json(payload);
  });

  router.post('/just-go', authRequired(), async (req, res) => {
    const parsed = justGoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });

    const userId = req.freeUser.id;
    const minuteSlot = Math.floor(Date.now() / 60000);
    const day = utcDayKey();

    const minuteAllowed = await consumeMinuteLimit(cache, `free:rl:user:${userId}:${minuteSlot}`, limits.user_minute_limit);
    if (!minuteAllowed) return limitExceeded(res, nextMinuteIso());

    const dailyKey = `free:quota:user:search:${userId}:${day}`;
    const dailyAllowed = await consumeDailyLimit(cache, dailyKey, limits.daily_search_limit);
    if (!dailyAllowed) return limitExceeded(res, nextUtcMidnightIso());

    const body = parsed.data;
    const cacheKey = `free:justgo:user:${userId}:${body.origin}:${body.budget}:${body.days}:${body.season}:${body.mood}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const rows = await getJustGoPrecomputed(body);
    const payload = {
      mode: 'free',
      source: 'precomputed',
      ai_included: false,
      ai_message: 'AI not included in free plan.',
      items: rows
    };
    await cache.setex(cacheKey, 1800, JSON.stringify(payload));
    return res.json(payload);
  });

  router.get('/alerts', authRequired(), async (req, res) => {
    const items = await listAlerts(req.freeUser.id);
    return res.json({ items });
  });

  router.post('/alerts', authRequired(), async (req, res) => {
    const parsed = createAlertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });

    const userId = req.freeUser.id;
    let alert;
    try {
      alert = await createAlert({
        userId,
        originIata: parsed.data.origin.toUpperCase(),
        destinationIata: parsed.data.destination.toUpperCase(),
        targetPrice: parsed.data.target_price,
        maxAlerts: limits.active_alert_limit
      });
    } catch (err) {
      if (err.code === 'alert_limit_reached') return limitExceeded(res, nextUtcMidnightIso());
      throw err;
    }
    await cache.lpush('free:queue:alerts:evaluate', JSON.stringify({ alertId: alert.id, userId, at: new Date().toISOString() }));

    appendImmutableAudit({
      category: 'free_alerts',
      type: 'create',
      success: true,
      userId,
      ipHash: hashIp(getClientIp(req)),
      alertId: alert.id
    }).catch(() => {});

    return res.status(201).json({ item: alert });
  });

  router.delete('/alerts/:id', authRequired(), async (req, res) => {
    const ok = await deleteAlert({ userId: req.freeUser.id, alertId: req.params.id });
    if (!ok) return res.status(404).json({ error: 'Alert not found.' });
    return res.status(204).send();
  });

  router.get('/usage', async (req, res) => {
    const token = parseBearer(req);
    const day = utcDayKey();
    const resetAt = nextUtcMidnightIso();

    try {
      if (token) {
        const payload = verifyAccessToken(token);
        const user = await getUserById(payload?.sub);
        if (!user) return res.status(401).json({ error: 'Invalid token.' });
        const usedSearches = await getDailyCount(cache, `free:quota:user:search:${user.id}:${day}`);
        const activeAlerts = await countActiveAlerts(user.id);
        return res.json({
          plan: 'free',
          ai_included: false,
          ai_message: 'AI not included in free plan.',
          daily_search_limit: limits.daily_search_limit,
          used_searches: usedSearches,
          remaining_searches: Math.max(0, limits.daily_search_limit - usedSearches),
          active_alert_limit: limits.active_alert_limit,
          active_alerts: activeAlerts,
          remaining_active_alerts: Math.max(0, limits.active_alert_limit - activeAlerts),
          reset_at: resetAt
        });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid token.' });
    }

    const deviceId = getDeviceId(req, res);
    const usedSearches = await getDailyCount(cache, `free:quota:demo:search:${deviceId}:${day}`);
    return res.json({
      plan: 'demo',
      ai_included: false,
      ai_message: 'AI not included in free plan.',
      daily_search_limit: limits.demo_daily_search_limit,
      used_searches: usedSearches,
      remaining_searches: Math.max(0, limits.demo_daily_search_limit - usedSearches),
      active_alert_limit: 0,
      active_alerts: 0,
      remaining_active_alerts: 0,
      reset_at: resetAt
    });
  });

  return router;
}
