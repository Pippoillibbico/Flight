import 'dotenv/config';
import { spawn } from 'node:child_process';
import pg from 'pg';
import Redis from 'ioredis';

const REQUIRED_SECRETS = [
  'JWT_SECRET',
  'OUTBOUND_CLICK_SECRET',
  'AUDIT_LOG_HMAC_KEY',
  'INTERNAL_INGEST_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_PRO',
  'STRIPE_PRICE_CREATOR',
  'AFFILIATE_TRAVELPAYOUTS_MARKER'
];

const SAFE_LOG_LEVELS_PROD = new Set(['info', 'warn', 'error', 'fatal']);
const SAFE_TX_ISOLATIONS = new Set(['read committed', 'repeatable read', 'serializable']);
const PLACEHOLDER_PATTERNS = ['replace-with', 'changeme', 'example.com', 'your-', 'todo', 'placeholder'];

function hasValue(name) {
  return String(process.env[name] || '').trim().length > 0;
}

function hasStrongValue(name, minLength = 1) {
  const value = String(process.env[name] || '').trim();
  if (value.length < minLength) return false;
  const lower = value.toLowerCase();
  return !PLACEHOLDER_PATTERNS.some((pattern) => lower.includes(pattern));
}

function asBool(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function parseNumber(value, fallback) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function normalizeIsolation(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, ' ');
}

function parseUrlStrict(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`invalid_url:${name}`);
  }
  return parsed;
}

function expectExactEnv(name, expectedValue) {
  const actual = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  const expected = String(expectedValue || '')
    .trim()
    .toLowerCase();
  if (!actual) throw new Error(`missing_required_env:${name}`);
  if (actual !== expected) {
    throw new Error(`env_exact_match_failed:${name}:${actual}->${expected}`);
  }
}

function assertWebhookUrl(name) {
  const url = parseUrlStrict(name);
  if (!url) throw new Error(`missing_required_secret:${name}`);
  if (url.protocol !== 'https:') throw new Error(`invalid_webhook_protocol:${name}`);
}

function assertTargetBaseUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) throw new Error('missing_required_secret:TARGET_BASE_URL_OR_PROD_BASE_URL');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('invalid_url:TARGET_BASE_URL_OR_PROD_BASE_URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('invalid_url_protocol:TARGET_BASE_URL_OR_PROD_BASE_URL');
  }
}

async function validateWebhookDeliveryOptional() {
  const shouldValidate = asBool(process.env.VALIDATE_RELEASE_ALERT_WEBHOOK_DELIVERY, false);
  if (!shouldValidate) return;
  const webhook = String(process.env.RELEASE_ALERT_WEBHOOK_URL || '').trim();
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: '[ops:prod:readiness] webhook validation',
      type: 'ops_readiness_webhook_validation',
      timestamp: new Date().toISOString()
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`release_alert_webhook_validation_failed:${response.status}:${detail.slice(0, 160)}`);
  }
  console.log('[OK] release-alert-webhook delivery validated');
}

function assertLoggingPolicy() {
  const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (!isProd) return;
  const level = String(process.env.LOG_LEVEL || 'info').trim().toLowerCase();
  if (!SAFE_LOG_LEVELS_PROD.has(level)) {
    throw new Error(`unsafe_log_level_in_production:${level}`);
  }
  const retentionDays = parseNumber(process.env.LOG_RETENTION_DAYS, 14);
  if (retentionDays < 14) {
    throw new Error(`log_retention_too_low:${retentionDays}`);
  }
  console.log(`[OK] logging-policy level=${level} retentionDays=${retentionDays}`);
}

function assertDbUrlSecurity() {
  const parsed = parseUrlStrict('DATABASE_URL');
  if (!parsed) {
    throw new Error('missing_required_secret:DATABASE_URL');
  }
  const host = String(parsed.hostname || '').trim().toLowerCase();
  const localhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!localhost) {
    const hasSslMode = /sslmode=require/i.test(parsed.search || '');
    const hasSslTrue = /ssl=true/i.test(parsed.search || '');
    if (!hasSslMode && !hasSslTrue) {
      throw new Error('database_url_ssl_not_enforced');
    }
  }
  console.log('[OK] database-url-security');
}

function assertRedisUrlSecurity() {
  const parsed = parseUrlStrict('REDIS_URL');
  if (!parsed) {
    throw new Error('missing_required_secret:REDIS_URL');
  }
  const host = String(parsed.hostname || '').trim().toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    throw new Error('redis_url_localhost_not_allowed_in_production');
  }
  console.log('[OK] redis-url-security');
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.cmd, step.args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`step_failed:${step.name}`));
    });
    child.on('error', reject);
  });
}

async function checkPostgres() {
  const url = String(process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.log('[WARN] postgres-check skipped (DATABASE_URL missing)');
    return;
  }
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query('SELECT 1');
    const txIsolationResult = await pool.query('SHOW default_transaction_isolation');
    const timeoutResult = await pool.query('SHOW statement_timeout');
    const txIsolation = normalizeIsolation(txIsolationResult.rows[0]?.default_transaction_isolation || '');
    if (!SAFE_TX_ISOLATIONS.has(txIsolation)) {
      throw new Error(`unsafe_default_transaction_isolation:${txIsolation || 'unknown'}`);
    }
    const requiredIsolation = normalizeIsolation(process.env.DB_REQUIRED_TX_ISOLATION || 'read committed');
    if (requiredIsolation && txIsolation !== requiredIsolation) {
      throw new Error(`db_tx_isolation_mismatch:required=${requiredIsolation}:actual=${txIsolation}`);
    }
    const statementTimeoutRaw = String(timeoutResult.rows[0]?.statement_timeout || '').trim();
    if (!statementTimeoutRaw || statementTimeoutRaw === '0') {
      throw new Error('statement_timeout_not_set');
    }
    console.log(
      `[OK] postgres-check connected isolation=${txIsolation} statement_timeout=${statementTimeoutRaw}`
    );
  } finally {
    await pool.end();
  }
}

async function checkRedis() {
  const url = String(process.env.REDIS_URL || '').trim();
  if (!url) {
    console.log('[WARN] redis-check skipped (REDIS_URL missing)');
    return;
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true
  });
  try {
    await client.connect();
    const pong = await client.ping();
    if (String(pong).toUpperCase() !== 'PONG') throw new Error('unexpected_redis_ping');
    console.log('[OK] redis-check connected');
  } finally {
    client.disconnect();
  }
}

async function run() {
  console.log('[ops:prod:readiness] start');
  const strict = asBool(process.env.OPS_READINESS_STRICT, true);
  if (!strict) {
    console.log('[WARN] strict-mode disabled (OPS_READINESS_STRICT=false)');
  }
  const missingSecrets = REQUIRED_SECRETS.filter((key) => !hasStrongValue(key, 8));
  if (missingSecrets.length > 0) {
    throw new Error(`missing_required_secrets:${missingSecrets.join(',')}`);
  }
  console.log('[OK] required-secrets present');

  if (strict) {
    expectExactEnv('ENABLE_PROVIDER_DUFFEL', 'true');
    expectExactEnv('ENABLE_PROVIDER_KIWI', 'false');
    expectExactEnv('ENABLE_PROVIDER_SKYSCANNER', 'false');
    expectExactEnv('ENABLE_TRAVELPAYOUTS_AFFILIATE', 'true');
    expectExactEnv('AI_ALLOW_FREE_USERS', 'false');
    expectExactEnv('ALLOW_MOCK_BILLING_UPGRADES', 'false');
    expectExactEnv('STRIPE_ALLOW_INLINE_PRICE_DATA', 'false');
    assertWebhookUrl('RELEASE_ALERT_WEBHOOK_URL');
    assertLoggingPolicy();
    assertDbUrlSecurity();
    assertRedisUrlSecurity();
    await validateWebhookDeliveryOptional();
  }

  await checkPostgres();
  await checkRedis();

  const steps = [
    { name: 'preflight-prod', cmd: 'npm', args: ['run', 'preflight:prod'] },
    { name: 'load-gate', cmd: 'npm', args: ['run', 'test:load:gate'] }
  ];

  if (hasValue('DATABASE_URL')) {
    steps.push({ name: 'db-migrations-status', cmd: 'npm', args: ['run', 'db:migrations:status'] });
  }

  const targetBaseUrl = String(process.env.TARGET_BASE_URL || process.env.PROD_BASE_URL || '').trim();
  if (targetBaseUrl) {
    assertTargetBaseUrl(targetBaseUrl);
    process.env.PROD_BASE_URL = targetBaseUrl;
    steps.push({ name: 'prod-external-audit', cmd: 'npm', args: ['run', 'test:prod:external'] });
  } else {
    throw new Error('missing_required_secret:TARGET_BASE_URL_OR_PROD_BASE_URL');
  }

  for (const step of steps) {
    console.log(`\n[ops:prod:readiness] running ${step.name}`);
    await runStep(step);
  }

  console.log('\n[ops:prod:readiness] all checks passed');
}

run().catch((error) => {
  console.error('\n[ops:prod:readiness] failed');
  console.error(error?.message || error);
  process.exit(1);
});
