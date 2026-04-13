/**
 * Flight Suite - Admin Backoffice Server
 *
 * ARCHITECTURE NOTE — TWO-SERVER DESIGN:
 * This is a completely separate Express process from the main API server.
 *
 *   Main API server  →  server/index.js   (PORT, default 3000)
 *   Admin backoffice →  server/backoffice.js  (BACKOFFICE_PORT, default 3001)
 *
 * They share the same JSON database (data/db.json) and PostgreSQL pool but
 * use independent JWT secrets (BACKOFFICE_JWT_SECRET vs JWT_SECRET).
 *
 * The main React SPA calls admin endpoints via the main server proxy route
 * GET/POST /api/admin/backoffice/* which is mounted in server/index.js and
 * proxied to this process.  The backoffice UI HTML is served directly from
 * this process on BACKOFFICE_PORT.
 *
 * STARTING BOTH SERVERS:
 *   node server/index.js          (main)
 *   node server/backoffice.js     (backoffice — optional, only needed for admin)
 *
 * In Docker Compose, add a second service entry to start this process.
 * The main server does NOT start the backoffice automatically.
 *
 * REQUIRED ENV VARS:
 *   BACKOFFICE_JWT_SECRET        — strong dedicated secret (required in prod)
 *   ADMIN_BACKOFFICE_PASSWORD    — or BACKOFFICE_ADMIN_CREDENTIALS for per-user auth
 *   BACKOFFICE_PORT              — default 3001
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { SignJWT, jwtVerify } from 'jose';
import pino from 'pino';
import { buildAdminBackofficeReport } from './lib/admin-backoffice-report.js';
import { readDb } from './lib/db.js';
import { parseCookieHeader } from './lib/http-cookies.js';
import { getFollowSignalsSummary } from './lib/opportunity-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKOFFICE_UI_FILE = join(__dirname, 'backoffice-ui.html');
const CHART_JS_FILE = join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js');

const PORT = Number(process.env.BACKOFFICE_PORT || 3001);
const SESSION_COOKIE = 'boff_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8h
const SHARED_SECRET_RAW = String(process.env.ADMIN_BACKOFFICE_PASSWORD || '');
const ALLOWED_EMAILS = new Set(
  String(process.env.ADMIN_ALLOWLIST_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);
const ADMIN_EMAIL = [...ALLOWED_EMAILS][0] || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LOGIN_WINDOW_MS = Math.max(30_000, Number(process.env.BACKOFFICE_LOGIN_WINDOW_MS || 10 * 60 * 1000));
const LOGIN_MAX_ATTEMPTS = Math.max(3, Number(process.env.BACKOFFICE_LOGIN_MAX_ATTEMPTS || 8));
const LOGIN_RATE_LIMIT_MAX = Math.max(LOGIN_MAX_ATTEMPTS, Number(process.env.BACKOFFICE_LOGIN_RATE_LIMIT_MAX || 12));
const BACKOFFICE_TRUST_PROXY_RAW = String(process.env.BACKOFFICE_TRUST_PROXY || '').trim().toLowerCase();
const BACKOFFICE_ALLOW_SHARED_PASSWORD_IN_PRODUCTION = String(process.env.BACKOFFICE_ALLOW_SHARED_PASSWORD_IN_PRODUCTION || 'false')
  .trim()
  .toLowerCase() === 'true';

function parseBackofficeCredentials(rawValue) {
  const map = new Map();
  const entries = String(rawValue || '')
    .split(/[,\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const separator = entry.includes('=') ? '=' : entry.includes(':') ? ':' : '';
    if (!separator) continue;
    const [rawEmail, ...rest] = entry.split(separator);
    const email = String(rawEmail || '').trim().toLowerCase();
    const password = rest.join(separator).trim();
    if (!email || !password) continue;
    map.set(email, password);
  }
  return map;
}

const BACKOFFICE_PER_USER_CREDENTIALS = parseBackofficeCredentials(process.env.BACKOFFICE_ADMIN_CREDENTIALS);

function isStrongJwtSecret(value) {
  const secret = String(value || '').trim();
  if (secret.length < 32) return false;
  if (/backoffice-dev-secret-change-in-prod/i.test(secret)) return false;
  if (/replace-with|example|changeme|default|secret/i.test(secret)) return false;
  return true;
}

function isStrongSharedBackofficePassword(value) {
  const secret = String(value || '').trim();
  if (secret.length < 16) return false;
  if (/replace-with|example|changeme|default|secret/i.test(secret)) return false;
  return true;
}

function parseTrustProxyValue(rawValue, isProduction) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (!value) return isProduction ? null : false;
  if (value === 'false' || value === '0') return false;
  if (value === 'true') return 1;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return value;
}

const logger = pino({ level: 'info' }, pino.destination(1));

function resolveBackofficeJwtSecret() {
  const configured = String(process.env.BACKOFFICE_JWT_SECRET || process.env.JWT_SECRET || '').trim();
  if (isStrongJwtSecret(configured)) return configured;
  if (IS_PRODUCTION) {
    logger.fatal('Missing strong BACKOFFICE_JWT_SECRET (or JWT_SECRET) in production.');
    process.exit(1);
  }
  const ephemeral = randomBytes(48).toString('base64url');
  logger.warn('BACKOFFICE_JWT_SECRET missing or weak - generated ephemeral dev secret');
  return ephemeral;
}

const JWT_SECRET_KEY = new TextEncoder().encode(resolveBackofficeJwtSecret());
const loginFailures = new Map();
const BACKOFFICE_TRUST_PROXY = parseTrustProxyValue(BACKOFFICE_TRUST_PROXY_RAW, IS_PRODUCTION);

if (!existsSync(BACKOFFICE_UI_FILE)) {
  logger.fatal({ file: BACKOFFICE_UI_FILE }, 'backoffice_ui_html_missing');
  process.exit(1);
}

if (IS_PRODUCTION && (BACKOFFICE_TRUST_PROXY == null || BACKOFFICE_TRUST_PROXY === false)) {
  logger.fatal(
    {
      BACKOFFICE_TRUST_PROXY: BACKOFFICE_TRUST_PROXY_RAW || '(empty)',
      hint: 'Set BACKOFFICE_TRUST_PROXY explicitly to match your reverse proxy chain.'
    },
    'backoffice_startup_blocked_proxy_misconfigured'
  );
  process.exit(1);
}

if (!existsSync(CHART_JS_FILE)) {
  logger.fatal({ file: CHART_JS_FILE }, 'backoffice_chartjs_missing');
  process.exit(1);
}

if (!SHARED_SECRET_RAW) {
  logger.warn('ADMIN_BACKOFFICE_PASSWORD not set - backoffice login disabled');
}

if (ALLOWED_EMAILS.size === 0) {
  logger.warn('ADMIN_ALLOWLIST_EMAILS not set - no backoffice users configured');
}

if (IS_PRODUCTION && BACKOFFICE_PER_USER_CREDENTIALS.size === 0) {
  if (!BACKOFFICE_ALLOW_SHARED_PASSWORD_IN_PRODUCTION) {
    logger.fatal(
      {
        hint: 'Set BACKOFFICE_ADMIN_CREDENTIALS (email=password pairs) or explicitly allow shared password in production.'
      },
      'backoffice_startup_blocked_missing_per_user_credentials'
    );
    process.exit(1);
  }
  if (!isStrongSharedBackofficePassword(SHARED_SECRET_RAW)) {
    logger.fatal(
      {
        hint: 'ADMIN_BACKOFFICE_PASSWORD must be strong (>=16 chars, non-placeholder) when shared-password mode is enabled.'
      },
      'backoffice_startup_blocked_weak_shared_password'
    );
    process.exit(1);
  }
}

if (IS_PRODUCTION && BACKOFFICE_PER_USER_CREDENTIALS.size > 0 && ALLOWED_EMAILS.size > 0) {
  const missingCredentials = [...ALLOWED_EMAILS].filter((email) => !BACKOFFICE_PER_USER_CREDENTIALS.has(email));
  if (missingCredentials.length > 0 && !BACKOFFICE_ALLOW_SHARED_PASSWORD_IN_PRODUCTION) {
    logger.fatal(
      {
        missingCredentials
      },
      'backoffice_startup_blocked_incomplete_admin_credentials'
    );
    process.exit(1);
  }
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').trim() || 'unknown';
}

function loginFailureKey(email, ip) {
  return `${String(email || '').toLowerCase()}|${String(ip || '').trim() || 'unknown'}`;
}

function pruneLoginFailures(nowMs = Date.now()) {
  for (const [key, entry] of loginFailures.entries()) {
    if (!entry || Number(entry.resetAt || 0) <= nowMs) loginFailures.delete(key);
  }
}

function getLoginFailureState(email, ip) {
  pruneLoginFailures();
  const key = loginFailureKey(email, ip);
  return loginFailures.get(key) || null;
}

function registerLoginFailure(email, ip) {
  const nowMs = Date.now();
  pruneLoginFailures(nowMs);
  const key = loginFailureKey(email, ip);
  const current = loginFailures.get(key) || { count: 0, resetAt: nowMs + LOGIN_WINDOW_MS };
  const next = {
    count: Number(current.count || 0) + 1,
    resetAt: Math.max(Number(current.resetAt || 0), nowMs + LOGIN_WINDOW_MS)
  };
  loginFailures.set(key, next);
  return next;
}

function clearLoginFailures(email, ip) {
  loginFailures.delete(loginFailureKey(email, ip));
}

function safeEqual(leftValue, rightValue) {
  try {
    const left = Buffer.from(String(leftValue || ''));
    const right = Buffer.from(String(rightValue || ''));
    if (left.length !== right.length) {
      timingSafeEqual(left, Buffer.alloc(left.length));
      return false;
    }
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function setSessionCookie(res, token) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];
  if (IS_PRODUCTION) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0'
  ];
  if (IS_PRODUCTION) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function issueToken(email) {
  return new SignJWT({ sub: email, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(JWT_SECRET_KEY);
}

async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY);
    if (payload?.role !== 'admin') return null;
    return payload;
  } catch {
    return null;
  }
}

async function requireAdminPage(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.redirect('/login');
  const payload = await verifyToken(token);
  if (!payload) return res.redirect('/login');
  req.adminEmail = payload.sub;
  return next();
}

async function requireAdminApi(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'unauthorized' });
  req.adminEmail = payload.sub;
  return next();
}

function renderLoginPage({ showError = false } = {}) {
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Flight Suite Admin Login</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: Inter, Segoe UI, Arial, sans-serif;
      background: radial-gradient(circle at 20% 20%, #11325f 0%, #08152a 44%, #040a14 100%);
      color: #e7f0ff;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      border-radius: 16px;
      border: 1px solid rgba(123, 169, 238, 0.28);
      background: rgba(10, 24, 47, 0.88);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
      padding: 22px 28px 28px;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
    }
    .subtitle {
      margin: 0 0 20px;
      color: #98b6df;
      font-size: 14px;
    }
    .lang-btn {
      border: 1px solid rgba(146, 188, 252, 0.6);
      background: linear-gradient(180deg, #ffffff 0%, #edf4ff 100%);
      color: #163f84;
      border-radius: 9px;
      min-height: 34px;
      padding: 7px 11px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease, background 0.15s ease;
    }
    .lang-btn:hover {
      background: linear-gradient(180deg, #ffffff 0%, #f3f8ff 100%);
      color: #103978;
      border-color: #98c3ff;
      box-shadow:
        0 0 0 1px rgba(141, 186, 255, 0.9),
        0 0 16px rgba(82, 143, 230, 0.35);
    }
    .row { margin-bottom: 14px; }
    label {
      display: block;
      margin: 0 0 6px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #91b4e4;
    }
    input {
      width: 100%;
      border: 1px solid rgba(123, 169, 238, 0.34);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.06);
      color: #eef5ff;
      font-size: 15px;
      padding: 11px 12px;
      outline: none;
    }
    input:focus {
      border-color: #6aa8ff;
      box-shadow: 0 0 0 3px rgba(87, 149, 243, 0.2);
    }
    .err {
      margin: 0 0 16px;
      border-radius: 10px;
      border: 1px solid rgba(239, 68, 68, 0.45);
      background: rgba(239, 68, 68, 0.16);
      color: #f9b4b4;
      padding: 10px 12px;
      font-size: 13px;
    }
    button {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 10px;
      cursor: pointer;
      background: linear-gradient(180deg, #4c9dff, #2f7de8);
      color: #ffffff;
      font-weight: 700;
      font-size: 15px;
      padding: 11px 12px;
    }
    button:hover {
      filter: brightness(1.05);
    }
    .hint {
      margin: 14px 0 0;
      font-size: 12px;
      color: #7d9fcd;
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="head">
      <h1 id="title">Admin Backoffice</h1>
      <button id="langBtn" type="button" class="lang-btn">English</button>
    </div>
    <p id="subtitle" class="subtitle">Flight Suite - accesso riservato</p>
    ${showError ? '<p id="errorMsg" class="err">Email o password non validi.</p>' : ''}
    <form method="post" action="/login" autocomplete="on">
      <div class="row">
        <label id="emailLabel" for="email">Email</label>
        <input id="email" name="email" type="email" required autocomplete="email" />
      </div>
      <div class="row">
        <label id="passwordLabel" for="password">Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password" />
      </div>
      <button id="submitBtn" type="submit">Accedi</button>
    </form>
    <p id="hint" class="hint">Solo email in allowlist possono entrare.</p>
  </main>
  <script>
    (function () {
      var KEY = 'backoffice_lang';
      var lang = (localStorage.getItem(KEY) || 'it').toLowerCase();
      if (lang !== 'it' && lang !== 'en') lang = 'it';
      var dict = {
        it: {
          title: 'Admin Backoffice',
          subtitle: 'Flight Suite - accesso riservato',
          email: 'Email',
          password: 'Password',
          submit: 'Accedi',
          hint: 'Solo email in allowlist possono entrare.',
          err: 'Email o password non validi.',
          switchLang: 'English',
          pageTitle: 'Flight Suite Admin Login'
        },
        en: {
          title: 'Admin Backoffice',
          subtitle: 'Flight Suite - restricted access',
          email: 'Email',
          password: 'Password',
          submit: 'Sign in',
          hint: 'Only allowlisted emails can sign in.',
          err: 'Invalid email or password.',
          switchLang: 'Italiano',
          pageTitle: 'Flight Suite Admin Login'
        }
      };

      function byId(id) {
        return document.getElementById(id);
      }

      function render() {
        var p = dict[lang] || dict.it;
        document.documentElement.lang = lang;
        document.title = p.pageTitle;
        byId('title').textContent = p.title;
        byId('subtitle').textContent = p.subtitle;
        byId('emailLabel').textContent = p.email;
        byId('passwordLabel').textContent = p.password;
        byId('submitBtn').textContent = p.submit;
        byId('hint').textContent = p.hint;
        var e = byId('errorMsg');
        if (e) e.textContent = p.err;
        byId('langBtn').textContent = p.switchLang;
      }

      byId('langBtn').addEventListener('click', function () {
        lang = lang === 'it' ? 'en' : 'it';
        localStorage.setItem(KEY, lang);
        render();
      });

      render();
    })();
  </script>
</body>
</html>`;
}

const app = express();
app.set('trust proxy', BACKOFFICE_TRUST_PROXY == null ? false : BACKOFFICE_TRUST_PROXY);
app.disable('x-powered-by');
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    }
  })
);
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use((req, _res, next) => {
  req.cookies = parseCookieHeader(req.headers.cookie);
  next();
});

const loginRateLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `backoffice-login:${clientIp(req)}`,
  skipSuccessfulRequests: true,
  handler: (_req, res) => {
    clearSessionCookie(res);
    return res.status(429).redirect('/login?error=1');
  }
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/assets/chart.umd.min.js', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(CHART_JS_FILE);
});

app.get('/login', (req, res) => {
  const showError = String(req.query?.error || '') === '1';
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).type('html').send(renderLoginPage({ showError }));
});

app.post('/login', loginRateLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const ip = clientIp(req);
  const attempts = getLoginFailureState(email, ip);
  if (attempts && Number(attempts.count || 0) >= LOGIN_MAX_ATTEMPTS) {
    const retryAfterSec = Math.max(1, Math.ceil((Number(attempts.resetAt || Date.now()) - Date.now()) / 1000));
    logger.warn({ email, ip, retryAfterSec }, 'backoffice_login_temporarily_blocked');
    clearSessionCookie(res);
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).redirect('/login?error=1');
  }

  const emailAllowed = ALLOWED_EMAILS.has(email);
  const perUserPassword = BACKOFFICE_PER_USER_CREDENTIALS.get(email) || '';
  const passwordMatchesPerUser = perUserPassword.length > 0 && safeEqual(password, perUserPassword);
  const canFallbackToSharedPassword =
    SHARED_SECRET_RAW.length > 0 &&
    (BACKOFFICE_PER_USER_CREDENTIALS.size === 0 || !IS_PRODUCTION || BACKOFFICE_ALLOW_SHARED_PASSWORD_IN_PRODUCTION);
  const passwordMatchesShared = canFallbackToSharedPassword && safeEqual(password, SHARED_SECRET_RAW);
  const passwordMatches = passwordMatchesPerUser || passwordMatchesShared;

  if (!emailAllowed || !passwordMatches) {
    const failedState = registerLoginFailure(email, ip);
    logger.warn({ email, ip, attempts: failedState.count, resetAt: new Date(failedState.resetAt).toISOString() }, 'backoffice_login_failed');
    clearSessionCookie(res);
    return res.redirect('/login?error=1');
  }

  clearLoginFailures(email, ip);
  const token = await issueToken(email);
  setSessionCookie(res, token);
  logger.info({ email, ip }, 'backoffice_login_success');
  return res.redirect('/');
});

app.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  return res.redirect('/login');
});

app.get('/api/report', requireAdminApi, async (_req, res) => {
  try {
    const db = await readDb();
    const followSignals = await getFollowSignalsSummary({ limit: 10 }).catch(() => ({ total: 0, topRoutes: [] }));
    const report = buildAdminBackofficeReport({
      db,
      followSignals,
      now: Date.now(),
      windowDays: 30
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, report });
  } catch (error) {
    logger.error({ err: error }, 'backoffice_report_error');
    return res.status(500).json({ ok: false, error: 'Failed to build report' });
  }
});

app.get('/', requireAdminPage, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(BACKOFFICE_UI_FILE);
});

app.get('/backoffice-ui.html', requireAdminPage, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(BACKOFFICE_UI_FILE);
});

app.use((_req, res) => {
  res.status(404).type('text').send('Not Found');
});

app.listen(PORT, () => {
  logger.info({ port: PORT, admin: ADMIN_EMAIL || null }, 'backoffice_server_started');
});
