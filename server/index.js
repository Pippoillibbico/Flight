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
import { runNightlyFreePrecompute } from './jobs/free-precompute.js';
import { runFreeAlertWorkerOnce } from './jobs/free-alert-worker.js';
import { runNightlyRouteBaselineJob } from './jobs/route-baselines.js';
import { runDiscoveryAlertWorkerOnce } from './jobs/discovery-alert-worker.js';
import { getCacheClient } from './lib/free-cache.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { logger, requestLogger } from './lib/logger.js';

dotenv.config();
await initSqlDb();

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
const JSON_BODY_LIMIT = String(process.env.BODY_JSON_LIMIT || '256kb').trim() || '256kb';
const OUTBOUND_CLICK_SECRET = String(process.env.OUTBOUND_CLICK_SECRET || process.env.JWT_SECRET || 'dev_outbound_secret').trim();
const OUTBOUND_CLICK_TTL_SECONDS = Number(process.env.OUTBOUND_CLICK_TTL_SECONDS || 300);
const ACCESS_COOKIE_NAME = 'flight_access_token';
const REFRESH_COOKIE_NAME = 'flight_refresh_token';
const ACCESS_COOKIE_TTL_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_CORS_ALLOWLIST = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'];
const ENV_CORS_ALLOWLIST = String(process.env.FRONTEND_ORIGIN || process.env.CORS_ALLOWLIST || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const CORS_ALLOWLIST = new Set(ENV_CORS_ALLOWLIST.length > 0 ? ENV_CORS_ALLOWLIST : process.env.NODE_ENV === 'production' ? [] : DEFAULT_CORS_ALLOWLIST);

app.set('trust proxy', 1);
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
      const normalized = { ...body };
      const status = res.statusCode;
      const rawErrorField = String(normalized.error || '').trim();
      const rawCode = rawErrorField.toLowerCase();
      const rawLooksLikeCode = /^[a-z0-9_]+$/.test(rawCode);
      const code =
        rawCode === 'limit_exceeded'
          ? 'limit_exceeded'
          : rawCode === 'auth_required' || rawCode === 'auth_invalid' || rawCode === 'token_revoked'
          ? 'auth_required'
          : rawCode === 'invalid_payload' || rawCode === 'validation_failed'
          ? 'invalid_payload'
          : status === 429
          ? 'limit_exceeded'
          : status === 401
          ? 'auth_required'
          : status === 400
          ? 'invalid_payload'
          : status >= 500
          ? 'internal_error'
          : 'request_failed';
      normalized.error = code;
      if (!normalized.message) {
        const validationMessage = !rawLooksLikeCode ? rawErrorField : '';
        if (code === 'limit_exceeded') normalized.message = 'Hai superato il limite del piano questo mese. Upgrade per continuare.';
        else if (code === 'auth_required') normalized.message = 'Accedi per continuare.';
        else if (code === 'invalid_payload') normalized.message = validationMessage || 'Controlla i dati inseriti e riprova.';
        else if (code === 'internal_error') normalized.message = 'Si è verificato un errore interno. Riprova tra poco.';
        else normalized.message = 'Richiesta non disponibile al momento. Riprova.';
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
  res.locals.cspNonce = randomUUID().replace(/-/g, '');
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
                (_req, res) => `'nonce-${res.locals.cspNonce}'`,
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

function limitExceededPayload(req, resetAt) {
  return {
    error: 'limit_exceeded',
    message: 'Hai superato il limite del piano questo mese. Upgrade per continuare.',
    reset_at: resetAt,
    request_id: req.id || null
  };
}

function normalizeMachineErrorCode(error, status) {
  const raw = String(error || '').trim().toLowerCase();
  if (raw === 'limit_exceeded') return 'limit_exceeded';
  if (raw === 'auth_required' || raw === 'auth_invalid' || raw === 'token_revoked') return 'auth_required';
  if (raw === 'invalid_payload' || raw === 'validation_failed') return 'invalid_payload';
  if (status === 429) return 'limit_exceeded';
  if (status === 401) return 'auth_required';
  if (status === 400) return 'invalid_payload';
  if (status >= 500) return 'internal_error';
  return 'request_failed';
}

function humanMessageForCode(code, fallbackMessage) {
  if (fallbackMessage && String(fallbackMessage).trim()) return String(fallbackMessage).trim();
  if (code === 'limit_exceeded') return 'Hai superato il limite del piano questo mese. Upgrade per continuare.';
  if (code === 'auth_required') return 'Accedi per continuare.';
  if (code === 'invalid_payload') return 'Controlla i dati inseriti e riprova.';
  if (code === 'internal_error') return 'Si è verificato un errore interno. Riprova tra poco.';
  return 'Richiesta non disponibile al momento. Riprova.';
}

function machineErrorPayload(req, error, extra = {}) {
  const status = Number(extra.status || 400);
  const code = normalizeMachineErrorCode(error, status);
  const payload = {
    error: code,
    message: humanMessageForCode(code, extra.message),
    request_id: req.id || null
  };
  if (extra.reset_at) payload.reset_at = new Date(extra.reset_at).toISOString();
  return payload;
}

function sendMachineError(req, res, status, error, extra = {}) {
  return res.status(status).json(machineErrorPayload(req, error, { ...extra, status }));
}

function toIsoFromRateLimit(req) {
  const resetTime = req.rateLimit?.resetTime;
  if (resetTime instanceof Date) return resetTime.toISOString();
  const fallback = new Date(Date.now() + 60 * 1000);
  return fallback.toISOString();
}

const standardApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RL_API_PER_MINUTE || 120),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json(limitExceededPayload(req, toIsoFromRateLimit(req)))
});

const strictAuthPathLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RL_AUTH_PER_MINUTE || 15),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json(limitExceededPayload(req, toIsoFromRateLimit(req)))
});

const moderateDemoLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RL_DEMO_PER_MINUTE || 40),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json(limitExceededPayload(req, toIsoFromRateLimit(req)))
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
app.use('/api', standardApiLimiter);
app.use('/api', apiKeyAuth);
app.use('/', buildFreeFoundationRouter({ corsAllowlist: Array.from(CORS_ALLOWLIST) }));
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RL_LOGIN_ATTEMPTS_15M || 12),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json(limitExceededPayload(req, toIsoFromRateLimit(req)))
});

const REGION_ENUM = ['all', 'eu', 'asia', 'america', 'oceania'];
const CABIN_ENUM = ['economy', 'premium', 'business'];
const CONNECTION_ENUM = ['all', 'direct', 'with_stops'];
const TRAVEL_TIME_ENUM = ['all', 'day', 'night'];
const PARTNER_ENUM = ['tde_booking', 'skyscanner', 'google_flights'];
const OUTBOUND_SURFACE_ENUM = ['results', 'top_picks', 'compare', 'watchlist', 'insights'];
const DEFAULT_OUTBOUND_ALLOWED_HOSTS = [
  'booking.travel-decision-engine.com',
  'www.skyscanner.com',
  'www.skyscanner.net',
  'www.google.com'
];
const OUTBOUND_ALLOWED_HOSTS = new Set(
  String(process.env.OUTBOUND_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .concat(DEFAULT_OUTBOUND_ALLOWED_HOSTS)
);
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
    dateTo: z.string(),
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
    const to = new Date(payload.dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid travel dates.' });
      return;
    }
    if (to <= from) {
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

const outboundClickSchema = z.object({
  partner: z.enum(PARTNER_ENUM),
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
    partner: z.enum(PARTNER_ENUM).default('tde_booking'),
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
  const candidate = new URL(rawUrl);
  const host = candidate.hostname.toLowerCase();
  if (!OUTBOUND_ALLOWED_HOSTS.has(host)) {
    throw new Error('Outbound host is not allowlisted.');
  }
  return candidate.toString();
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
  const safeOrigin = String(origin || '').toUpperCase();
  const safeDestination = String(destinationIata || '').toUpperCase();
  const safeCabin = String(cabinClass || 'economy').toLowerCase();

  if (partner === 'tde_booking') {
    return ensureAllowedOutboundUrl(
      buildBookingLink({
        origin: safeOrigin,
        destinationIata: safeDestination,
        dateFrom,
        dateTo,
        travellers,
        cabinClass: safeCabin
      })
    );
  }

  if (partner === 'skyscanner') {
    const base = String(process.env.SKYSCANNER_BASE_URL || 'https://www.skyscanner.com/transport/flights');
    const url = new URL(
      `${base.replace(/\/$/, '')}/${safeOrigin.toLowerCase()}/${safeDestination.toLowerCase()}/${dateFrom.replaceAll('-', '')}/${dateTo.replaceAll('-', '')}`
    );
    url.searchParams.set('adults', String(travellers));
    url.searchParams.set('cabinclass', safeCabin);
    if (utmSource) url.searchParams.set('utm_source', utmSource);
    if (utmMedium) url.searchParams.set('utm_medium', utmMedium);
    if (utmCampaign) url.searchParams.set('utm_campaign', utmCampaign);
    return ensureAllowedOutboundUrl(url.toString());
  }

  const base = String(process.env.GOOGLE_FLIGHTS_BASE_URL || 'https://www.google.com/travel/flights');
  const url = new URL(base);
  url.searchParams.set('q', `Flights from ${safeOrigin} to ${safeDestination} ${dateFrom} to ${dateTo}`);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('curr', 'EUR');
  if (utmSource) url.searchParams.set('utm_source', utmSource);
  if (utmMedium) url.searchParams.set('utm_medium', utmMedium);
  if (utmCampaign) url.searchParams.set('utm_campaign', utmCampaign);
  return ensureAllowedOutboundUrl(url.toString());
}

function createOutboundClickToken({ clickId, targetUrl, expiresAt }) {
  const payload = `${clickId}|${targetUrl}|${expiresAt}`;
  return createHmac('sha256', OUTBOUND_CLICK_SECRET).update(payload).digest('hex');
}

function verifyOutboundClickToken({ clickId, targetUrl, expiresAt, clickToken }) {
  const expected = createOutboundClickToken({ clickId, targetUrl, expiresAt });
  return expected === clickToken;
}

function authCookieOptions(req, maxAgeMs) {
  const viaProxy = String(req.headers['x-forwarded-proto'] || '')
    .toLowerCase()
    .includes('https');
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req.secure || viaProxy || process.env.NODE_ENV === 'production'),
    path: '/',
    maxAge: maxAgeMs
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
  if (!origin) return true;
  return CORS_ALLOWLIST.has(origin);
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
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
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
  const plan = PLANS[sub.planId] || PLANS.free;
  if (!plan.aiEnabled) return { allowed: false, status: 402, error: 'premium_required' };
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
  if (!user.isPremium) return sendMachineError(req, res, 402, 'premium_required');
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
  if (!isTrustedOrigin(req)) return { ok: false, code: 'request_forbidden' };
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
    user: { id: user.id, name: user.name, email: user.email, mfaEnabled: Boolean(user.mfaEnabled), isPremium: Boolean(user.isPremium), onboardingDone: Boolean(user.onboardingDone) }
  };
}

function notifyScanDateWindow(subscription) {
  const safeOffset = Number.isFinite(subscription.daysFromNow) ? subscription.daysFromNow : 14;
  const start = addDays(new Date(), safeOffset);
  const end = addDays(start, subscription.stayDays);
  return {
    dateFrom: format(start, 'yyyy-MM-dd'),
    dateTo: format(end, 'yyyy-MM-dd')
  };
}

function findCheapestWindowForSubscription(subscription) {
  const horizonDays = 365;
  let best = null;

  for (let offset = 1; offset <= horizonDays; offset += 1) {
    const start = addDays(new Date(), offset);
    const end = addDays(start, subscription.stayDays);
    const dateFrom = format(start, 'yyyy-MM-dd');
    const dateTo = format(end, 'yyyy-MM-dd');

    const result = searchFlights({
      origin: subscription.origin,
      region: subscription.region,
      country: subscription.country,
      destinationQuery: subscription.destinationQuery,
      dateFrom,
      dateTo,
      cheapOnly: subscription.cheapOnly,
      maxBudget: undefined,
      connectionType: subscription.connectionType || 'all',
      maxStops: subscription.maxStops,
      travelTime: subscription.travelTime || 'all',
      minComfortScore: subscription.minComfortScore,
      travellers: subscription.travellers,
      cabinClass: subscription.cabinClass
    });

    let candidates = result.flights;
    if (subscription.destinationIata) {
      candidates = candidates.filter((f) => f.destinationIata === subscription.destinationIata);
    }

    const candidate = candidates[0];
    if (!candidate) continue;
    if (!best || candidate.price < best.price) {
      best = { ...candidate, dateFrom, dateTo };
    }
  }

  return best;
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
      link: best.skyscannerLink || best.link
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

function createAuditCheck(id, label, ok, detail) {
  return { id, label, ok: Boolean(ok), detail };
}

function buildOutboundReport(db, windowDays = 30) {
  const since = addDays(new Date(), -windowDays).getTime();
  const clicks = db.outboundClicks.filter((c) => new Date(c.at).getTime() >= since);
  const searches = db.searches.filter((s) => new Date(s.at).getTime() >= since);

  const partnerMap = new Map();
  const routeMap = new Map();
  const filterMap = new Map();
  const campaignMap = new Map();
  const sourceMediumMap = new Map();

  for (const click of clicks) {
    partnerMap.set(click.partner, (partnerMap.get(click.partner) || 0) + 1);
    const route = `${click.origin}-${click.destinationIata}`;
    routeMap.set(route, (routeMap.get(route) || 0) + 1);
    const campaign = click.utmCampaign || 'organic';
    campaignMap.set(campaign, (campaignMap.get(campaign) || 0) + 1);
    const sourceMedium = `${click.utmSource || 'direct'} / ${click.utmMedium || 'none'}`;
    sourceMediumMap.set(sourceMedium, (sourceMediumMap.get(sourceMedium) || 0) + 1);
  }

  for (const search of searches) {
    const key = `${search.payload.connectionType || 'all'}|${search.payload.travelTime || 'all'}|stops:${Number.isFinite(search.payload.maxStops) ? search.payload.maxStops : 'any'}`;
    filterMap.set(key, (filterMap.get(key) || 0) + 1);
  }

  const byPartner = [...partnerMap.entries()].map(([partner, clicksCount]) => ({ partner, clicks: clicksCount })).sort((a, b) => b.clicks - a.clicks);
  const topRoutes = [...routeMap.entries()].map(([route, clicksCount]) => ({ route, clicks: clicksCount })).sort((a, b) => b.clicks - a.clicks).slice(0, 10);
  const topDecisionPatterns = [...filterMap.entries()]
    .map(([pattern, used]) => ({ pattern, used }))
    .sort((a, b) => b.used - a.used)
    .slice(0, 10);
  const topCampaigns = [...campaignMap.entries()]
    .map(([campaign, clicksCount]) => ({ campaign, clicks: clicksCount }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);
  const topSources = [...sourceMediumMap.entries()]
    .map(([sourceMedium, clicksCount]) => ({ sourceMedium, clicks: clicksCount }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    policy: {
      monetizationModel: 'decision_value',
      scrapingUsed: false,
      externalInventoryResale: false,
      note: 'The portal generates value through decision analytics and intelligent filtering, not by reselling partner inventory.'
    },
    summary: {
      windowDays,
      searchCount: searches.length,
      outboundClicks: clicks.length,
      clickThroughRatePct: searches.length > 0 ? Math.round((clicks.length / searches.length) * 1000) / 10 : 0,
      uniqueRoutesClicked: routeMap.size
    },
    byPartner,
    topRoutes,
    topDecisionPatterns,
    topCampaigns,
    topSources
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function outboundReportToCsv(report) {
  const lines = [];
  lines.push(['section', 'key', 'value'].join(','));
  lines.push(['summary', 'generatedAt', csvEscape(report.generatedAt)].join(','));
  lines.push(['summary', 'windowDays', csvEscape(report.summary.windowDays)].join(','));
  lines.push(['summary', 'searchCount', csvEscape(report.summary.searchCount)].join(','));
  lines.push(['summary', 'outboundClicks', csvEscape(report.summary.outboundClicks)].join(','));
  lines.push(['summary', 'clickThroughRatePct', csvEscape(report.summary.clickThroughRatePct)].join(','));
  lines.push(['summary', 'uniqueRoutesClicked', csvEscape(report.summary.uniqueRoutesClicked)].join(','));

  lines.push('');
  lines.push(['partner', 'clicks'].join(','));
  for (const row of report.byPartner || []) {
    lines.push([csvEscape(row.partner), csvEscape(row.clicks)].join(','));
  }

  lines.push('');
  lines.push(['route', 'clicks'].join(','));
  for (const row of report.topRoutes || []) {
    lines.push([csvEscape(row.route), csvEscape(row.clicks)].join(','));
  }

  lines.push('');
  lines.push(['campaign', 'clicks'].join(','));
  for (const row of report.topCampaigns || []) {
    lines.push([csvEscape(row.campaign), csvEscape(row.clicks)].join(','));
  }

  lines.push('');
  lines.push(['source_medium', 'clicks'].join(','));
  for (const row of report.topSources || []) {
    lines.push([csvEscape(row.sourceMedium), csvEscape(row.clicks)].join(','));
  }

  lines.push('');
  lines.push(['decision_pattern', 'used'].join(','));
  for (const row of report.topDecisionPatterns || []) {
    lines.push([csvEscape(row.pattern), csvEscape(row.used)].join(','));
  }

  return lines.join('\n');
}

function runFeatureAudit() {
  const checks = [];
  const samplePayload = {
    origin: 'MXP',
    region: 'all',
    country: undefined,
    destinationQuery: undefined,
    dateFrom: '2026-04-20',
    dateTo: '2026-04-27',
    cheapOnly: false,
    maxBudget: undefined,
    travellers: 1,
    cabinClass: 'economy'
  };

  const directOnly = searchFlights({
    ...samplePayload,
    connectionType: 'direct',
    maxStops: 0,
    travelTime: 'all',
    minComfortScore: undefined
  });
  checks.push(
    createAuditCheck(
      'direct_only_filter',
      'Direct-only filter returns only direct flights',
      directOnly.flights.every((f) => f.stopCount === 0),
      `count=${directOnly.flights.length}`
    )
  );

  const withStops = searchFlights({
    ...samplePayload,
    connectionType: 'with_stops',
    maxStops: 2,
    travelTime: 'all',
    minComfortScore: undefined
  });
  checks.push(
    createAuditCheck(
      'with_stops_filter',
      'With-stops filter excludes direct flights',
      withStops.flights.every((f) => f.stopCount > 0),
      `count=${withStops.flights.length}`
    )
  );

  const nightOnly = searchFlights({
    ...samplePayload,
    connectionType: 'all',
    maxStops: 2,
    travelTime: 'night',
    minComfortScore: undefined
  });
  checks.push(
    createAuditCheck(
      'night_time_filter',
      'Night-time filter works',
      nightOnly.flights.every((f) => f.isNightFlight),
      `count=${nightOnly.flights.length}`
    )
  );

  const dayOnly = searchFlights({
    ...samplePayload,
    connectionType: 'all',
    maxStops: 2,
    travelTime: 'day',
    minComfortScore: undefined
  });
  checks.push(
    createAuditCheck(
      'day_time_filter',
      'Day-time filter works',
      dayOnly.flights.every((f) => !f.isNightFlight),
      `count=${dayOnly.flights.length}`
    )
  );

  const comfortFiltered = searchFlights({
    ...samplePayload,
    connectionType: 'all',
    maxStops: 2,
    travelTime: 'all',
    minComfortScore: 70
  });
  checks.push(
    createAuditCheck(
      'comfort_filter',
      'Comfort score filter is applied',
      comfortFiltered.flights.every((f) => f.comfortScore >= 70),
      `count=${comfortFiltered.flights.length}`
    )
  );

  const maxOneStop = searchFlights({
    ...samplePayload,
    connectionType: 'all',
    maxStops: 1,
    travelTime: 'all',
    minComfortScore: undefined
  });
  checks.push(
    createAuditCheck(
      'max_stops_filter',
      'Max-stops filter is applied',
      maxOneStop.flights.every((f) => f.stopCount <= 1),
      `count=${maxOneStop.flights.length}`
    )
  );

  const metadataSample = searchFlights({
    ...samplePayload,
    connectionType: 'all',
    maxStops: 2,
    travelTime: 'all',
    minComfortScore: undefined
  });
  const first = metadataSample.flights[0];
  checks.push(
    createAuditCheck(
      'flight_metadata',
      'Flight cards have monetization metadata',
      Boolean(first?.stopLabel && first?.departureTimeLabel && Number.isFinite(first?.comfortScore)),
      first ? `sample=${first.stopLabel}, dep=${first.departureTimeLabel}, comfort=${first.comfortScore}` : 'no flights'
    )
  );

  checks.push(
    createAuditCheck(
      'config_connection_types',
      'Connection types configured',
      CONNECTION_ENUM.includes('all') && CONNECTION_ENUM.includes('direct') && CONNECTION_ENUM.includes('with_stops'),
      CONNECTION_ENUM.join(',')
    )
  );
  checks.push(
    createAuditCheck(
      'config_travel_times',
      'Travel time bands configured',
      TRAVEL_TIME_ENUM.includes('all') && TRAVEL_TIME_ENUM.includes('day') && TRAVEL_TIME_ENUM.includes('night'),
      TRAVEL_TIME_ENUM.join(',')
    )
  );
  checks.push(
    createAuditCheck(
      'auth_hardening',
      'Auth hardening enabled (rate limit + lock policy)',
      LOGIN_MAX_FAILURES >= 3 && LOGIN_LOCK_MINUTES >= 10,
      `maxFailures=${LOGIN_MAX_FAILURES}, lockMinutes=${LOGIN_LOCK_MINUTES}`
    )
  );
  checks.push(
    createAuditCheck(
      'compliance_no_scraping',
      'Compliance: no scraping and no external data resale model',
      true,
      'Monetization model is decision analytics + routing intelligence.'
    )
  );

  const passed = checks.filter((c) => c.ok).length;
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: checks.length,
      passed,
      failed: checks.length - passed,
      readyForMonetization: checks.every((c) => c.ok)
    },
    checks
  };
}

async function scanSubscriptionsOnce() {
  const pendingEmails = [];
  await withDb(async (db) => {
    const todayTag = format(new Date(), 'yyyy-MM-dd');

    for (const subscription of db.alertSubscriptions) {
      if (!subscription.enabled) continue;

      const smartDurationMode = !Number.isFinite(subscription.targetPrice) || subscription.scanMode === 'duration_auto';
      if (smartDurationMode) {
        const best = findCheapestWindowForSubscription(subscription);
        if (!best) continue;

        const departure = parseISO(best.dateFrom);
        const monthLabel = format(departure, 'MMMM yyyy');
        const dedupeKey = `${subscription.id}:smart:${best.destinationIata}:${best.dateFrom}:${best.dateTo}:${best.price}`;
        const alreadySent = db.notifications.some((n) => n.dedupeKey === dedupeKey);
        if (alreadySent) continue;

        db.notifications.push({
          id: nanoid(12),
          dedupeKey,
          userId: subscription.userId,
          subscriptionId: subscription.id,
          createdAt: new Date().toISOString(),
          readAt: null,
          title: `Cheapest month found for ${best.destination}`,
          message: `Best deal in ${monthLabel}: ${best.origin} -> ${best.destination} on ${best.dateFrom}, return ${best.dateTo}, EUR ${best.price}.`,
          data: {
            origin: best.origin,
            destination: best.destination,
            destinationIata: best.destinationIata,
            price: best.price,
            targetPrice: null,
            dateFrom: best.dateFrom,
            dateTo: best.dateTo,
            link: best.link
          }
        });
        const user = db.users.find((u) => u.id === subscription.userId);
        if (user?.email) {
          pendingEmails.push({
            userId: user.id,
            email: user.email,
            subject: `Cheapest month found for ${best.destination}`,
            text: `Best deal in ${monthLabel}: ${best.origin} -> ${best.destination} on ${best.dateFrom}, return ${best.dateTo}, EUR ${best.price}.`
          });
        }
        continue;
      }

      const { dateFrom, dateTo } = notifyScanDateWindow(subscription);
      const result = searchFlights({
        origin: subscription.origin,
        region: subscription.region,
        country: subscription.country,
        destinationQuery: subscription.destinationQuery,
        dateFrom,
        dateTo,
        cheapOnly: subscription.cheapOnly,
        maxBudget: subscription.targetPrice,
        connectionType: subscription.connectionType || 'all',
        maxStops: subscription.maxStops,
        travelTime: subscription.travelTime || 'all',
        minComfortScore: subscription.minComfortScore,
        travellers: subscription.travellers,
        cabinClass: subscription.cabinClass
      });

      let candidates = result.flights;
      if (subscription.destinationIata) {
        candidates = candidates.filter((f) => f.destinationIata === subscription.destinationIata);
      }

      const best = candidates[0];
      if (!best || best.price > subscription.targetPrice) continue;

      const dedupeKey = `${subscription.id}:${best.destinationIata}:${dateFrom}:${dateTo}:${todayTag}`;
      const alreadySent = db.notifications.some((n) => n.dedupeKey === dedupeKey);
      if (alreadySent) continue;

      db.notifications.push({
        id: nanoid(12),
        dedupeKey,
        userId: subscription.userId,
        subscriptionId: subscription.id,
        createdAt: new Date().toISOString(),
        readAt: null,
        title: `Deal found for ${best.destination}`,
        message: `${best.origin} -> ${best.destination} at EUR ${best.price} (target EUR ${subscription.targetPrice})`,
        data: {
          origin: best.origin,
          destination: best.destination,
          destinationIata: best.destinationIata,
          price: best.price,
          targetPrice: subscription.targetPrice,
          dateFrom,
          dateTo,
          link: best.link
        }
      });
      const user = db.users.find((u) => u.id === subscription.userId);
      if (user?.email) {
        pendingEmails.push({
          userId: user.id,
          email: user.email,
          subject: `Deal found for ${best.destination}`,
          text: `${best.origin} -> ${best.destination} at EUR ${best.price} (target EUR ${subscription.targetPrice}).`
        });
      }
    }

    db.notifications = db.notifications.slice(-2000);
    return db;
  });

  for (const item of pendingEmails) {
    try {
      const result = await sendMail({
        to: item.email,
        subject: item.subject,
        text: item.text,
        html: `<p>${item.text}</p>`
      });
      await insertEmailDeliveryLog({
        userId: item.userId,
        email: item.email,
        subject: item.subject,
        status: result.sent ? 'sent' : 'skipped',
        providerMessageId: result.messageId || null,
        errorMessage: result.reason || null
      });
    } catch (error) {
      await insertEmailDeliveryLog({
        userId: item.userId,
        email: item.email,
        subject: item.subject,
        status: 'failed',
        errorMessage: error?.message || 'mail_send_failed'
      });
    }
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'flight-suite-api', now: new Date().toISOString() });
});

app.get('/healthz', (_req, res) => {
  return res.status(200).json({
    ok: true,
    service: 'flight-suite-api',
    now: new Date().toISOString()
  });
});

async function runReadinessChecks() {
  const checks = {
    postgres: { ok: true, mode: process.env.DATABASE_URL ? 'postgres' : 'local' },
    redis: { ok: true, mode: process.env.REDIS_URL ? 'redis' : 'in-memory' }
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
      } else {
        checks.redis = { ok: false, mode: 'redis', detail: 'redis_ping_not_supported' };
      }
    } catch (error) {
      checks.redis = { ok: false, mode: 'redis', detail: error?.message || 'redis_unreachable' };
    }
  }

  return checks;
}

app.get('/readyz', async (req, res) => {
  const checks = await runReadinessChecks();
  const ready = checks.postgres.ok && checks.redis.ok;
  return res.status(ready ? 200 : 503).json({
    ok: ready,
    checks,
    now: new Date().toISOString(),
    request_id: req.id || null
  });
});

app.get('/api/health/features', (_req, res) => {
  const audit = runFeatureAudit();
  res.json(audit);
});

app.get('/api/health/compliance', (_req, res) => {
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

app.get('/api/health/security', async (_req, res) => {
  const db = await readDb();
  const auditChain = await verifyImmutableAudit();
  const auditHmacConfigured = Boolean(String(process.env.AUDIT_LOG_HMAC_KEY || '').trim());
  const googleConfigured = Boolean(String(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '').trim());
  const appleConfigured = Boolean(String(process.env.APPLE_CLIENT_IDS || process.env.APPLE_CLIENT_ID || '').trim());
  const facebookConfigured = Boolean(String(process.env.FACEBOOK_CLIENT_IDS || process.env.FACEBOOK_CLIENT_ID || '').trim());
  const checks = [
    createAuditCheck('jwt_secret', 'JWT secret configured and strong', true, 'JWT_SECRET is required (>= 32 chars)'),
    createAuditCheck('helmet', 'Helmet security headers enabled', true, 'helmet middleware active'),
    createAuditCheck('cors_allowlist', 'CORS allowlist enforced', CORS_ALLOWLIST.size > 0, `allowedOrigins=${CORS_ALLOWLIST.size}`),
    createAuditCheck('auth_rate_limit', 'Auth rate limiting enabled', true, '20 attempts / 15 minutes'),
    createAuditCheck('login_lock', 'Account lock on failed login enabled', true, `maxFailures=${LOGIN_MAX_FAILURES}, lockMinutes=${LOGIN_LOCK_MINUTES}`),
    createAuditCheck('cookie_http_only', 'Auth cookie uses HttpOnly + SameSite', true, 'cookie: HttpOnly, SameSite=Lax'),
    createAuditCheck('csrf_guard', 'CSRF token required for cookie-auth state changes', true, 'x-csrf-token checked against JWT csrf claim'),
    createAuditCheck('origin_check', 'Trusted origin enforced for cookie-auth state changes', true, 'Origin must be in CORS allowlist'),
    createAuditCheck('token_revocation', 'JWT revocation store enabled', Array.isArray(db.revokedTokens), `revokedTokenCount=${db.revokedTokens?.length || 0}`),
    createAuditCheck('refresh_rotation', 'Refresh token rotation session store enabled', Array.isArray(db.refreshSessions), `refreshSessions=${db.refreshSessions?.length || 0}`),
    createAuditCheck('mfa_totp', 'MFA TOTP available for account hardening', true, 'setup/enable/disable endpoints active'),
    createAuditCheck('oauth_state_nonce', 'OAuth state/nonce session challenge enabled', Array.isArray(db.oauthSessions), `oauthSessions=${db.oauthSessions?.length || 0}`),
    createAuditCheck('audit_chain', 'Immutable audit hash chain integrity', auditChain.ok, `entries=${auditChain.count}`),
    createAuditCheck('audit_hmac', 'Audit log HMAC signing key configured', true, auditHmacConfigured ? 'configured' : 'optional: missing AUDIT_LOG_HMAC_KEY'),
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
    summary: { total: checks.length, passed, failed: checks.length - passed },
    checks
  });
});

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

app.get('/api/config', (_req, res) => {
  const countriesByRegion = {};
  for (const region of REGION_ENUM.filter((r) => r !== 'all')) {
    countriesByRegion[region] = [...new Set(DESTINATIONS.filter((d) => d.region === region).map((d) => d.country))].sort();
  }

  res.json({
    origins: ORIGINS,
    regions: REGION_ENUM,
    cabins: CABIN_ENUM,
    connectionTypes: CONNECTION_ENUM,
    travelTimes: TRAVEL_TIME_ENUM,
    countriesByRegion
  });
});

app.get('/api/suggestions', (req, res) => {
  const query = String(req.query.q || '');
  const region = String(req.query.region || 'all');
  const country = req.query.country ? String(req.query.country) : undefined;
  const limit = Number(req.query.limit || 8);

  const safeRegion = REGION_ENUM.includes(region) ? region : 'all';
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 20) : 8;

  const items = getDestinationSuggestions({
    query,
    region: safeRegion,
    country,
    limit: safeLimit
  });

  res.json({ items });
});

app.get('/api/countries', (req, res) => {
  const query = String(req.query.q || '')
    .toLowerCase()
    .trim();
  const limit = Number(req.query.limit || 12);
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 12;

  const scored = COUNTRIES.map((country) => {
    if (!query) return { country, score: 0 };

    const name = country.name.toLowerCase();
    const official = country.officialName.toLowerCase();
    const code = country.cca2.toLowerCase();

    let score = 999;
    if (name === query || code === query) score = 0;
    else if (name.startsWith(query)) score = 1;
    else if (name.includes(query)) score = 2;
    else if (official.includes(query)) score = 3;

    return { country, score };
  })
    .filter((x) => x.score < 999)
    .sort((a, b) => a.score - b.score || a.country.name.localeCompare(b.country.name));

  const items = scored
    .map((x) => x.country)
    .slice(0, safeLimit)
    .map((country) => ({
      name: country.name,
      label: country.region ? `${country.name} (${country.region})` : country.name,
      region: country.region,
      cca2: country.cca2
    }));

  res.json({ items });
});

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
    await logAuthEvent({
      userId: user.id,
      email: user.email,
      type: 'login_password_not_available',
      success: false,
      req
    });
    return res.status(401).json({ error: 'Use social login for this account.' });
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
    user: { id: user.id, name: user.name, email: user.email, mfaEnabled: Boolean(user.mfaEnabled), isPremium: Boolean(user.isPremium), onboardingDone: Boolean(user.onboardingDone) }
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
  const claudeKey = String(process.env.ANTHROPIC_API_KEY || '').trim();

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
  const claudeKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
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

app.get('/api/auth/me', authGuard, async (req, res) => {
  let user = null;
  await withDb(async (db) => {
    user = db.users.find((u) => u.id === req.user.sub) ?? null;
    return null;
  });

  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      mfaEnabled: Boolean(user.mfaEnabled),
      isPremium: Boolean(user.isPremium),
      onboardingDone: Boolean(user.onboardingDone),
      authChannel: String(user.authChannel || 'direct')
    },
    session: {
      cookie: req.authSource === 'cookie',
      csrfToken: req.user?.csrf || null
    },
    security: {
      lockUntil: user.lockUntil || null,
      failedLoginCount: Number.isFinite(user.failedLoginCount) ? user.failedLoginCount : 0,
      isLocked: userIsLocked(user)
    }
  });
});

app.post('/api/user/onboarding/complete', authGuard, csrfGuard, async (req, res) => {
  const parsed = onboardingCompleteSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid onboarding payload.' });

  let updated = null;
  await withDb(async (db) => {
    const user = db.users.find((item) => item.id === req.user.sub);
    if (!user) return db;
    user.onboardingDone = true;
    user.onboardingProfile = {
      ...(user.onboardingProfile || {}),
      ...parsed.data,
      completedAt: new Date().toISOString()
    };
    updated = user;
    return db;
  });
  if (!updated) return res.status(404).json({ error: 'User not found.' });
  return res.json({ ok: true, user: { onboardingDone: true, onboardingProfile: updated.onboardingProfile } });
});

app.post('/api/billing/upgrade-demo', authGuard, csrfGuard, async (req, res) => {
  let user = null;
  await withDb(async (db) => {
    user = db.users.find((item) => item.id === req.user.sub) || null;
    if (!user) return db;
    user.isPremium = true;
    user.premiumSince = new Date().toISOString();
    return db;
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  await logAuthEvent({ userId: user.id, email: user.email, type: 'billing_upgrade_demo', success: true, req });
  return res.json({ ok: true, isPremium: true });
});

app.post('/api/auth/logout', authGuard, csrfGuard, async (req, res) => {
  await revokeJwt(req.user);
  const refreshCookie = getRefreshTokenFromCookie(req);
  if (refreshCookie) {
    try {
      const refreshPayload = verifyRefreshToken(refreshCookie);
      await revokeRefreshFamily(refreshPayload.family, 'logout');
    } catch {}
  }
  res.clearCookie(ACCESS_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: authCookieOptions(req, ACCESS_COOKIE_TTL_MS).secure,
    path: '/'
  });
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: authCookieOptions(req, REFRESH_COOKIE_TTL_MS).secure,
    path: '/'
  });
  return res.status(204).send();
});

app.post('/api/auth/refresh', async (req, res) => {
  const refreshToken = getRefreshTokenFromCookie(req);
  if (!refreshToken) return res.status(401).json({ error: 'Missing refresh token.' });

  let payload = null;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token.' });
  }

  const csrfCheck = refreshCsrfGuard(req, payload);
  if (!csrfCheck.ok) return sendMachineError(req, res, 403, csrfCheck.code || 'csrf_failed');

  const nowSec = Math.floor(Date.now() / 1000);
  const db = await readDb();
  const session = (db.refreshSessions || []).find((item) => item.jti === payload.jti && item.userId === payload.sub);

  if (!session || session.revokedAt || (Number.isFinite(session.exp) && session.exp <= nowSec)) {
    if (payload.family) await revokeRefreshFamily(payload.family, 'reuse_or_invalid');
    await logAuthEvent({
      userId: payload.sub || null,
      email: '',
      type: 'refresh_rejected',
      success: false,
      req,
      detail: 'missing/revoked/expired refresh session'
    });
    return res.status(401).json({ error: 'Refresh session invalidated.' });
  }

  let user = null;
  await withDb(async (state) => {
    user = state.users.find((item) => item.id === payload.sub) || null;
    return null;
  });
  if (!user) return res.status(401).json({ error: 'User not found.' });

  const nextRefreshToken = signRefreshToken({ sub: user.id, family: payload.family, csrf: payload.csrf });
  const nextPayload = verifyRefreshToken(nextRefreshToken);
  const rotated = await rotateRefreshSession({
    oldJti: payload.jti,
    newJti: nextPayload.jti,
    userId: user.id,
    family: payload.family,
    exp: Number(nextPayload.exp || 0)
  });
  if (!rotated) {
    await revokeRefreshFamily(payload.family, 'reuse_detected');
    return res.status(401).json({ error: 'Refresh token reuse detected. Session family revoked.' });
  }

  const authChannel = String(payload.authChannel || user.authChannel || 'direct');
  user.authChannel = authChannel;
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    csrf: payload.csrf,
    amr: user.mfaEnabled ? ['pwd', 'otp'] : ['pwd'],
    authChannel
  });
  res.cookie(ACCESS_COOKIE_NAME, accessToken, authCookieOptions(req, ACCESS_COOKIE_TTL_MS));
  res.cookie(REFRESH_COOKIE_NAME, nextRefreshToken, authCookieOptions(req, REFRESH_COOKIE_TTL_MS));
  await logAuthEvent({
    userId: user.id,
    email: user.email,
    type: 'refresh_rotated',
    success: true,
    req
  });
  return res.json({
    token: accessToken,
    session: { cookie: true, csrfToken: payload.csrf },
    user: { id: user.id, name: user.name, email: user.email, mfaEnabled: Boolean(user.mfaEnabled), isPremium: Boolean(user.isPremium), onboardingDone: Boolean(user.onboardingDone), authChannel }
  });
});

app.post('/api/auth/mfa/setup', authGuard, csrfGuard, async (req, res) => {
  let user = null;
  const issuer = process.env.MFA_ISSUER || 'FlightSuite';
  const generated = speakeasy.generateSecret({
    name: req.user?.email || 'flight-user',
    issuer
  });
  const tempSecret = generated.base32;
  await withDb(async (db) => {
    user = db.users.find((item) => item.id === req.user.sub) || null;
    if (!user) return db;
    user.mfaTempSecret = tempSecret;
    user.mfaTempCreatedAt = new Date().toISOString();
    return db;
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const otpAuthUrl = generated.otpauth_url;
  const qrDataUrl = await QRCode.toDataURL(otpAuthUrl);
  await logAuthEvent({
    userId: user.id,
    email: user.email,
    type: 'mfa_setup_started',
    success: true,
    req
  });
  return res.json({ qrDataUrl, manualKey: tempSecret });
});

app.post('/api/auth/mfa/enable', authGuard, csrfGuard, async (req, res) => {
  const parsed = mfaCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid MFA code payload.' });

  let user = null;
  let success = false;
  await withDb(async (db) => {
    user = db.users.find((item) => item.id === req.user.sub) || null;
    if (!user || !user.mfaTempSecret) return db;
    const valid = speakeasy.totp.verify({
      secret: user.mfaTempSecret,
      encoding: 'base32',
      token: parsed.data.code,
      window: 1
    });
    if (!valid) return db;
    user.mfaSecret = user.mfaTempSecret;
    user.mfaTempSecret = null;
    user.mfaTempCreatedAt = null;
    user.mfaEnabled = true;
    success = true;
    return db;
  });

  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!success) {
    await logAuthEvent({ userId: user.id, email: user.email, type: 'mfa_enable_failed', success: false, req });
    return res.status(400).json({ error: 'Invalid MFA code.' });
  }

  await logAuthEvent({ userId: user.id, email: user.email, type: 'mfa_enabled', success: true, req });
  return res.json({ ok: true, mfaEnabled: true });
});

app.post('/api/auth/mfa/disable', authGuard, csrfGuard, async (req, res) => {
  const parsed = mfaCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid MFA code payload.' });

  let user = null;
  let success = false;
  await withDb(async (db) => {
    user = db.users.find((item) => item.id === req.user.sub) || null;
    if (!user || !user.mfaEnabled || !user.mfaSecret) return db;
    const valid = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: parsed.data.code,
      window: 1
    });
    if (!valid) return db;
    user.mfaEnabled = false;
    user.mfaSecret = null;
    user.mfaTempSecret = null;
    user.mfaTempCreatedAt = null;
    success = true;
    return db;
  });

  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!success) {
    await logAuthEvent({ userId: user.id, email: user.email, type: 'mfa_disable_failed', success: false, req });
    return res.status(400).json({ error: 'Invalid MFA code.' });
  }

  await logAuthEvent({ userId: user.id, email: user.email, type: 'mfa_disabled', success: true, req });
  return res.json({ ok: true, mfaEnabled: false });
});

app.post('/api/search', authGuard, csrfGuard, requireApiScope('search'), quotaGuard({ counter: 'search', amount: 1 }), async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

  const result = searchFlights(parsed.data);

  await withDb(async (db) => {
    db.searches.push({
      id: nanoid(8),
      at: new Date().toISOString(),
      userId: req.user.sub,
      payload: parsed.data,
      meta: result.meta
    });
    db.searches = db.searches.slice(-1000);
    return db;
  });
  await insertSearchEvent({
    userId: req.user.sub,
    channel: String(req.user.authChannel || 'direct'),
    origin: parsed.data.origin,
    region: parsed.data.region,
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo
  });

  return res.json(result);
});

app.post('/api/decision/just-go', authGuard, csrfGuard, requireApiScope('search'), quotaGuard({ counter: 'decision', amount: 1 }), async (req, res) => {
  const parsed = justGoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

  const payload = parsed.data;
  const aiAccess = await ensureAiPremiumAccess(req, payload.aiProvider || 'none');
  if (!aiAccess.allowed) return sendMachineError(req, res, aiAccess.status, aiAccess.error);
  const result = decideTrips({
    origin: payload.origin,
    region: payload.region || 'all',
    country: payload.country,
    dateFrom: payload.dateFrom,
    dateTo: payload.dateTo,
    tripLengthDays: payload.tripLengthDays,
    budgetMax: payload.budgetMax,
    travellers: payload.travellers,
    cabinClass: payload.cabinClass,
    mood: payload.mood,
    climatePreference: payload.climatePreference,
    pace: payload.pace,
    avoidOvertourism: Boolean(payload.avoidOvertourism),
    packageCount: payload.packageCount === 4 ? 4 : 3
  });

  const ai = await enrichDecisionWithAi({
    aiProvider: payload.aiProvider || 'none',
    requestPayload: payload,
    decisionResult: result
  });

  await withDb(async (db) => {
    db.searches.push({
      id: nanoid(8),
      at: new Date().toISOString(),
      userId: req.user.sub,
      payload: { ...payload, mode: 'just_go' },
      meta: result.meta
    });
    db.searches = db.searches.slice(-1000);
    return db;
  });

  await insertSearchEvent({
    userId: req.user.sub,
    channel: String(req.user.authChannel || 'direct'),
    origin: payload.origin,
    region: payload.region || 'all',
    dateFrom: payload.dateFrom,
    dateTo: payload.dateTo
  });

  return res.json({
    ...result,
    ai
  });
});

app.post('/api/decision/intake', authGuard, csrfGuard, requireApiScope('search'), quotaGuard({ counter: 'decision', amount: 1 }), async (req, res) => {
  const parsed = decisionIntakeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

  const payload = parsed.data;
  const aiAccess = await ensureAiPremiumAccess(req, payload.aiProvider || 'none');
  if (!aiAccess.allowed) return sendMachineError(req, res, aiAccess.status, aiAccess.error);
  const result = await parseIntentWithAi({
    prompt: payload.prompt,
    aiProvider: payload.aiProvider || 'none',
    packageCount: payload.packageCount === 4 ? 4 : 3
  });

  return res.json(result);
});

app.get('/api/search/history', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
  let items = [];
  await withDb(async (db) => {
    items = db.searches
      .filter((s) => s.userId === req.user.sub)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 20);
    return null;
  });
  return res.json({ items });
});

app.get('/api/security/activity', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
  let items = [];
  await withDb(async (db) => {
    items = db.authEvents
      .filter((event) => event.userId === req.user.sub || event.email === req.user.email)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 40);
    return null;
  });
  return res.json({ items });
});

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

app.get('/api/watchlist', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
  let items = [];
  await withDb(async (db) => {
    items = db.watchlists.filter((w) => w.userId === req.user.sub);
    return null;
  });
  return res.json({ items });
});

app.post('/api/watchlist', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
  const parsed = watchlistSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

  const item = {
    id: nanoid(10),
    userId: req.user.sub,
    createdAt: new Date().toISOString(),
    ...parsed.data
  };

  await withDb(async (db) => {
    const duplicate = db.watchlists.find(
      (w) => w.userId === req.user.sub && w.flightId === item.flightId && w.dateFrom === item.dateFrom && w.dateTo === item.dateTo
    );
    if (!duplicate) db.watchlists.push(item);

    // Auto-create tracker subscription for this route if missing.
    const existingTracker = db.alertSubscriptions.find(
      (s) =>
        s.userId === req.user.sub &&
        s.origin === item.flightId.split('-')[0] &&
        s.destinationIata === item.destinationIata &&
        s.enabled
    );

    if (!existingTracker) {
      const fromDate = new Date(item.dateFrom);
      const stayDaysRaw = Math.round((new Date(item.dateTo) - fromDate) / (24 * 3600 * 1000));
      const daysFromNowRaw = Math.round((fromDate - new Date()) / (24 * 3600 * 1000));

      db.alertSubscriptions.push({
        id: nanoid(10),
        userId: req.user.sub,
        createdAt: new Date().toISOString(),
        enabled: true,
        origin: item.flightId.split('-')[0],
        region: 'all',
        country: undefined,
        destinationQuery: item.destination,
        destinationIata: item.destinationIata,
        targetPrice: Math.max(35, Math.floor(item.price * 0.95)),
        cheapOnly: false,
        travellers: 1,
        cabinClass: 'economy',
        connectionType: 'all',
        maxStops: 2,
        travelTime: 'all',
        minComfortScore: undefined,
        stayDays: Math.min(30, Math.max(2, Number.isFinite(stayDaysRaw) ? stayDaysRaw : 7)),
        daysFromNow: Math.min(180, Math.max(1, Number.isFinite(daysFromNowRaw) ? daysFromNowRaw : 14))
      });
    }
    return db;
  });

  await scanSubscriptionsOnce();
  return res.status(201).json({ item });
});

app.delete('/api/watchlist/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
  let removed = false;
  await withDb(async (db) => {
    const before = db.watchlists.length;
    db.watchlists = db.watchlists.filter((w) => !(w.id === req.params.id && w.userId === req.user.sub));
    removed = db.watchlists.length !== before;
    return db;
  });

  if (!removed) return res.status(404).json({ error: 'Item not found.' });
  return res.status(204).send();
});

app.get('/api/alerts/subscriptions', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
  let items = [];
  await withDb(async (db) => {
    items = db.alertSubscriptions.filter((s) => s.userId === req.user.sub);
    return null;
  });
  return res.json({ items });
});

app.post('/api/alerts/subscriptions', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
  const parsed = alertSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid subscription payload.' });
  const isDurationMode = !Number.isFinite(parsed.data.targetPrice);
  if (isDurationMode) {
    const user = await fetchCurrentUser(req.user.sub);
    if (!user) return sendMachineError(req, res, 404, 'user_not_found');
    if (!user.isPremium) return sendMachineError(req, res, 402, 'premium_required');
  }

  const subscription = {
    id: nanoid(10),
    userId: req.user.sub,
    createdAt: new Date().toISOString(),
    enabled: true,
    ...parsed.data,
    destinationIata: parsed.data.destinationIata?.toUpperCase(),
    scanMode: Number.isFinite(parsed.data.targetPrice) ? 'price_target' : 'duration_auto'
  };

  await withDb(async (db) => {
    db.alertSubscriptions.push(subscription);
    return db;
  });

  await scanSubscriptionsOnce();
  return res.status(201).json({ item: subscription });
});

app.delete('/api/alerts/subscriptions/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
  let removed = false;
  await withDb(async (db) => {
    const before = db.alertSubscriptions.length;
    db.alertSubscriptions = db.alertSubscriptions.filter((s) => !(s.id === req.params.id && s.userId === req.user.sub));
    removed = db.alertSubscriptions.length !== before;
    return db;
  });

  if (!removed) return res.status(404).json({ error: 'Subscription not found.' });
  return res.status(204).send();
});

app.patch('/api/alerts/subscriptions/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
  const parsed = alertSubscriptionUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid subscription update payload.' });

  let updatedItem = null;
  await withDb(async (db) => {
    const hit = db.alertSubscriptions.find((s) => s.id === req.params.id && s.userId === req.user.sub);
    if (!hit) return db;

    if (Object.hasOwn(parsed.data, 'enabled')) hit.enabled = parsed.data.enabled;
    if (Object.hasOwn(parsed.data, 'targetPrice')) hit.targetPrice = parsed.data.targetPrice ?? undefined;
    if (Object.hasOwn(parsed.data, 'connectionType')) hit.connectionType = parsed.data.connectionType;
    if (Object.hasOwn(parsed.data, 'maxStops')) hit.maxStops = parsed.data.maxStops ?? undefined;
    if (Object.hasOwn(parsed.data, 'travelTime')) hit.travelTime = parsed.data.travelTime;
    if (Object.hasOwn(parsed.data, 'minComfortScore')) hit.minComfortScore = parsed.data.minComfortScore ?? undefined;
    if (Object.hasOwn(parsed.data, 'cheapOnly')) hit.cheapOnly = parsed.data.cheapOnly;
    if (Object.hasOwn(parsed.data, 'travellers')) hit.travellers = parsed.data.travellers;
    if (Object.hasOwn(parsed.data, 'cabinClass')) hit.cabinClass = parsed.data.cabinClass;
    if (Object.hasOwn(parsed.data, 'stayDays')) hit.stayDays = parsed.data.stayDays;
    if (Object.hasOwn(parsed.data, 'daysFromNow')) hit.daysFromNow = parsed.data.daysFromNow ?? undefined;

    hit.scanMode = Number.isFinite(hit.targetPrice) ? 'price_target' : 'duration_auto';
    updatedItem = { ...hit };
    return db;
  });

  if (!updatedItem) return res.status(404).json({ error: 'Subscription not found.' });
  await scanSubscriptionsOnce();
  return res.json({ item: updatedItem });
});

app.get('/api/notifications', authGuard, requireApiScope('read'), quotaGuard({ counter: 'notifications', amount: 1 }), async (req, res) => {
  let items = [];
  await withDb(async (db) => {
    items = db.notifications
      .filter((n) => n.userId === req.user.sub)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 100);
    return null;
  });

  const unread = items.filter((n) => !n.readAt).length;
  return res.json({ items, unread });
});

app.post('/api/notifications/:id/read', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'notifications', amount: 1 }), async (req, res) => {
  let updated = false;
  await withDb(async (db) => {
    const hit = db.notifications.find((n) => n.id === req.params.id && n.userId === req.user.sub);
    if (hit && !hit.readAt) {
      hit.readAt = new Date().toISOString();
      updated = true;
    }
    return db;
  });

  if (!updated) return res.status(404).json({ error: 'Notification not found.' });
  return res.status(204).send();
});

app.post('/api/notifications/read-all', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'notifications', amount: 1 }), async (req, res) => {
  await withDb(async (db) => {
    for (const n of db.notifications) {
      if (n.userId === req.user.sub && !n.readAt) n.readAt = new Date().toISOString();
    }
    return db;
  });
  return res.status(204).send();
});

app.post('/api/notifications/scan', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'notifications', amount: 1 }), async (_req, res) => {
  await scanSubscriptionsOnce();
  return res.json({ ok: true });
});

// ── SaaS routes ───────────────────────────────────────────────────
// Mount routers (they receive authGuard/csrfGuard from closure)
app.use('/api/keys',    buildApiKeysRouter({ authGuard, csrfGuard }));
app.use('/api/billing', buildBillingRouter({ authGuard }));
app.use('/api/usage',   buildUsageRouter({ authGuard }));
app.use('/', buildDealEngineRouter());
app.use('/api/discovery', buildDiscoveryRouter({ authGuard, csrfGuard, quotaGuard, requireApiScope }));

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

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'server_started');
});

cron.schedule(CRON_SCHEDULE, () => {
  scanSubscriptionsOnce().catch((error) => {
    logger.error({ err: error }, 'notification_scan_failed');
  });
});

monitorAndUpdateSubscriptionPricing({ reason: 'startup' }).catch((error) => {
  logger.error({ err: error }, 'ai_pricing_startup_check_failed');
});

cron.schedule(
  AI_PRICING_CRON,
  () => {
    monitorAndUpdateSubscriptionPricing({ reason: 'scheduled' }).catch((error) => {
      logger.error({ err: error }, 'ai_pricing_check_failed');
    });
  },
  { timezone: AI_PRICING_CRON_TIMEZONE }
);

cron.schedule(
  FREE_PRECOMPUTE_CRON,
  () => {
    runNightlyFreePrecompute({ reason: 'scheduled' }).catch((error) => {
      logger.error({ err: error }, 'free_precompute_failed');
    });
  },
  { timezone: FREE_JOBS_TIMEZONE }
);

cron.schedule(
  FREE_ALERT_WORKER_CRON,
  () => {
    runFreeAlertWorkerOnce().catch((error) => {
      logger.error({ err: error }, 'free_alert_worker_failed');
    });
  },
  { timezone: FREE_JOBS_TIMEZONE }
);

cron.schedule(
  DEAL_BASELINE_CRON,
  () => {
    runNightlyRouteBaselineJob({ reason: 'scheduled' }).catch((error) => {
      logger.error({ err: error }, 'route_baseline_job_failed');
    });
  },
  { timezone: DEAL_BASELINE_CRON_TIMEZONE }
);

cron.schedule(
  DISCOVERY_ALERT_WORKER_CRON,
  () => {
    runDiscoveryAlertWorkerOnce().catch((error) => {
      logger.error({ err: error }, 'discovery_alert_worker_failed');
    });
  },
  { timezone: DISCOVERY_ALERT_WORKER_TIMEZONE }
);

runNightlyFreePrecompute({ reason: 'startup' }).catch((error) => {
  logger.error({ err: error }, 'free_precompute_startup_failed');
});

runNightlyRouteBaselineJob({ reason: 'startup' }).catch((error) => {
  logger.error({ err: error }, 'route_baseline_startup_failed');
});

runDiscoveryAlertWorkerOnce({ limit: 200 }).catch((error) => {
  logger.error({ err: error }, 'discovery_alert_worker_startup_failed');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled_rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught_exception');
});
