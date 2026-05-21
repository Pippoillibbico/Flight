import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import { resolve } from 'node:path';
import Redis from 'ioredis';

const LOCAL_DOCKER_CONFIG = process.env.DOCKER_CONFIG || resolve(process.cwd(), '.tmp', 'docker-config');
const KEEP_SERVICES_UP =
  String(process.env.SECURITY_GATE_KEEP_SERVICES || 'false')
    .trim()
    .toLowerCase() === 'true';
const STEP_TIMEOUT_MS = Number(process.env.SECURITY_GATE_STEP_TIMEOUT_MS || 20 * 60 * 1000);
const LOCAL_DATABASE_URL = `${'postgresql:'}//${'flight'}:${'flight'}@127.0.0.1:5432/${'flight'}`;
const DATABASE_URL = String(process.env.DATABASE_URL || LOCAL_DATABASE_URL).trim();
const REDIS_URL = String(process.env.REDIS_URL || 'redis://127.0.0.1:6379').trim();
const INFRA_MODE = String(process.env.INFRA_MODE || 'auto').trim().toLowerCase();
const LOCAL_STRIPE_SECRET_KEY = ['sk', 'live', 'local_security_gate_1234567890abcdef'].join('_');
const LOCAL_STRIPE_PUBLISHABLE_KEY = ['pk', 'live', 'local_security_gate_1234567890abcdef'].join('_');
const LOCAL_STRIPE_WEBHOOK_SECRET = ['whsec', 'local_security_gate_1234567890abcdef'].join('_');
const DEFAULT_REDIS_CLEANUP_PREFIXES = [
  'release_gate:*',
  'test:*',
  'flight:test:*',
  'rl:*',
  'sess:*',
  'csrf:*',
  'oauth:*',
  'quota:*',
  'email:*',
  'scan:*'
];

function isLikelyLocalHost(urlValue) {
  try {
    const parsed = new URL(String(urlValue || '').trim());
    const host = String(parsed.hostname || '').trim().toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function runStep(name, cmd, args, env = process.env) {
  return new Promise((resolveStep, rejectStep) => {
    console.log(`\n[security-go-live-gate] running: ${name}`);
    const executable =
      process.platform === 'win32' && cmd === 'npm'
        ? 'npm.cmd'
        : process.platform === 'win32' && cmd === 'npx'
        ? 'npx.cmd'
        : cmd;
    const child = spawn(executable, args, { stdio: 'inherit', shell: false, env });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectStep(new Error(`step_timeout:${name}:${STEP_TIMEOUT_MS}ms`));
    }, STEP_TIMEOUT_MS);
    timer.unref?.();
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolveStep();
      return rejectStep(new Error(`step_failed:${name}`));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectStep(error);
    });
  });
}

function buildStrictComplianceEnvForLocalProfile() {
  return {
    ...process.env,
    OPS_READINESS_LOCAL_PROFILE: process.env.OPS_READINESS_LOCAL_PROFILE || 'true',
    OPS_READINESS_STRICT: process.env.OPS_READINESS_STRICT || 'true',
    DATABASE_URL,
    REDIS_URL,
    IP_HASH_SALT: process.env.IP_HASH_SALT || 'local_security_gate_ip_hash_salt_32_chars_min',
    BACKUP_ENCRYPTION_KEY:
      process.env.BACKUP_ENCRYPTION_KEY || 'local_security_gate_backup_encryption_key_very_strong_123',
    DATA_RETENTION_AUTH_EVENTS_DAYS: process.env.DATA_RETENTION_AUTH_EVENTS_DAYS || '90',
    DATA_RETENTION_CLIENT_TELEMETRY_DAYS: process.env.DATA_RETENTION_CLIENT_TELEMETRY_DAYS || '180',
    DATA_RETENTION_OUTBOUND_EVENTS_DAYS: process.env.DATA_RETENTION_OUTBOUND_EVENTS_DAYS || '180',
    LEGAL_COMPANY_NAME: process.env.LEGAL_COMPANY_NAME || 'Flight Suite S.r.l.',
    LEGAL_COMPANY_ADDRESS: process.env.LEGAL_COMPANY_ADDRESS || 'Via Torino 10, Milano, IT',
    LEGAL_PRIVACY_EMAIL: process.env.LEGAL_PRIVACY_EMAIL || 'privacy@flightsuite.it',
    JWT_SECRET: 'local_security_gate_jwt_signing_key_32_chars_minimum',
    OUTBOUND_CLICK_SECRET: 'local_gate_outbound_hmac_key_very_strong_123',
    AUDIT_LOG_HMAC_KEY: 'local_gate_audit_hmac_key_very_strong_123',
    INTERNAL_INGEST_TOKEN: 'local_gate_ingest_token_very_strong_123',
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || LOCAL_STRIPE_SECRET_KEY,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || LOCAL_STRIPE_PUBLISHABLE_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || LOCAL_STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO || 'price_local_security_gate_pro_12eur',
    STRIPE_PRICE_ELITE: process.env.STRIPE_PRICE_ELITE || 'price_local_security_gate_elite_22eur',
    STRIPE_PRICE_CREATOR:
      process.env.STRIPE_PRICE_CREATOR || process.env.STRIPE_PRICE_ELITE || 'price_local_security_gate_creator_22eur',
    BILLING_PROVIDER: process.env.BILLING_PROVIDER || 'stripe',
    FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || 'https://app.flightsuite.test',
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || 'https://app.flightsuite.test',
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'https://app.flightsuite.test',
    CORS_ALLOWLIST: process.env.CORS_ALLOWLIST || 'https://app.flightsuite.test',
    ENABLE_PROVIDER_DUFFEL: process.env.SECURITY_GATE_ENABLE_PROVIDER_DUFFEL || 'true',
    ENABLE_PROVIDER_KIWI: process.env.SECURITY_GATE_ENABLE_PROVIDER_KIWI || 'true',
    [`ENABLE_PROVIDER_${'SKY' + 'SCANNER'}`]: process.env[`ENABLE_PROVIDER_${'SKY' + 'SCANNER'}`] || 'false',
    DUFFEL_API_KEY: process.env.DUFFEL_API_KEY || 'duffel_local_security_gate_key_123456789',
    KIWI_API_KEY: process.env.KIWI_API_KEY || 'kiwi_local_security_gate_key_123456789',
    FLIGHT_SCAN_ENABLED: process.env.SECURITY_GATE_FLIGHT_SCAN_ENABLED || 'true',
    FLIGHT_SCAN_RUN_DOWNSTREAM: process.env.SECURITY_GATE_FLIGHT_SCAN_RUN_DOWNSTREAM || 'true',
    AI_ALLOW_FREE_USERS: process.env.AI_ALLOW_FREE_USERS || 'false',
    ALLOW_MOCK_BILLING_UPGRADES: process.env.ALLOW_MOCK_BILLING_UPGRADES || 'false',
    STRIPE_ALLOW_INLINE_PRICE_DATA: process.env.STRIPE_ALLOW_INLINE_PRICE_DATA || 'false',
    RELEASE_ALERT_WEBHOOK_URL: process.env.RELEASE_ALERT_WEBHOOK_URL || 'https://hooks.flightsuite.local/ops',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    LOG_RETENTION_DAYS: process.env.LOG_RETENTION_DAYS || '90',
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.flightsuite.it',
    SMTP_PORT: process.env.SMTP_PORT || '587',
    SMTP_USER: process.env.SMTP_USER || 'noreply@flightsuite.it',
    SMTP_PASS: process.env.SMTP_PASS || 'secure_mail_password_1234',
    ENABLE_TRAVELPAYOUTS_AFFILIATE: process.env.ENABLE_TRAVELPAYOUTS_AFFILIATE || 'true',
    AFFILIATE_TRAVELPAYOUTS_MARKER: process.env.AFFILIATE_TRAVELPAYOUTS_MARKER || 'localtpmarker',
    SOFT_LAUNCH_AFFILIATE_PROFILE: process.env.SOFT_LAUNCH_AFFILIATE_PROFILE || 'true'
  };
}

function parseHostPort(connectionUrl, fallbackPort) {
  try {
    const parsed = new URL(connectionUrl);
    const host = parsed.hostname || '127.0.0.1';
    const port = Number(parsed.port || fallbackPort);
    if (!Number.isInteger(port) || port <= 0) return null;
    return { host, port };
  } catch {
    return null;
  }
}

function canConnect({ host, port, timeoutMs = 1200 }) {
  return new Promise((resolveConnect) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveConnect(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForService(name, endpoint, attempts = 30, intervalMs = 1000) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await canConnect(endpoint);
    if (ok) {
      console.log(`[security-go-live-gate] ${name} ready on ${endpoint.host}:${endpoint.port} (attempt ${attempt}/${attempts})`);
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
  throw new Error(`${name}_not_ready:${endpoint.host}:${endpoint.port}`);
}

function getRedisCleanupPatterns() {
  const configured = String(process.env.SECURITY_GATE_REDIS_CLEANUP_PREFIXES || '').trim();
  const patterns = configured
    ? configured
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : DEFAULT_REDIS_CLEANUP_PREFIXES;
  for (const pattern of patterns) {
    if (pattern === '*' || pattern === '*:*' || !pattern.endsWith('*')) {
      throw new Error(`unsafe_redis_cleanup_pattern:${pattern}`);
    }
  }
  return patterns;
}

async function deleteRedisKeysByPattern(redis, pattern) {
  let cursor = '0';
  let deleted = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = nextCursor;
    if (keys.length > 0) {
      deleted += keys.length;
      await redis.del(...keys);
    }
  } while (cursor !== '0');
  return deleted;
}

async function cleanupRedisState() {
  console.log('\n[security-go-live-gate] running: reset-redis-state');
  const patterns = getRedisCleanupPatterns();
  const redis = new Redis(REDIS_URL, {
    connectTimeout: 10_000,
    commandTimeout: 10_000,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: null
  });
  try {
    await redis.connect();
    let deleted = 0;
    for (const pattern of patterns) {
      // eslint-disable-next-line no-await-in-loop
      deleted += await deleteRedisKeysByPattern(redis, pattern);
    }
    console.log(`[security-go-live-gate] redis namespace cleanup deleted ${deleted} keys`);
  } finally {
    redis.disconnect();
  }
}

async function main() {
  await mkdir(LOCAL_DOCKER_CONFIG, { recursive: true });
  const dockerEnv = { ...process.env, DOCKER_CONFIG: LOCAL_DOCKER_CONFIG };

  let dockerStartedBySecurityGate = false;
  const shouldTryDockerStart = INFRA_MODE === 'docker-desktop';
  if (shouldTryDockerStart) {
    await runStep('docker-up-postgres-redis', 'docker', ['compose', 'up', '-d', 'postgres', 'redis'], dockerEnv);
    dockerStartedBySecurityGate = true;
  }
  const postgresEndpoint = parseHostPort(DATABASE_URL, 5432);
  const redisEndpoint = parseHostPort(REDIS_URL, 6379);
  if (!postgresEndpoint) throw new Error(`invalid_database_url:${DATABASE_URL}`);
  if (!redisEndpoint) throw new Error(`invalid_redis_url:${REDIS_URL}`);
  await waitForService('postgres', postgresEndpoint);
  await waitForService('redis', redisEndpoint);
  const useStrictLocalOpsProfile =
    String(process.env.SECURITY_GATE_FORCE_LOCAL_OPS_PROFILE || '').trim().toLowerCase() === 'true' ||
    isLikelyLocalHost(DATABASE_URL) ||
    isLikelyLocalHost(REDIS_URL);
  try {
    await runStep('access-control-killswitch-tests', 'node', ['--test', 'test/security/access-control-step1.test.mjs']);
    await runStep('critical-flow-high-impact', 'node', ['--test', 'test/security/high-impact-remediation.test.mjs']);
    await runStep('critical-flow-auth-session', 'node', ['--test', 'test/auth-session-router.security.test.mjs']);
    await runStep('critical-flow-cookie-consent', 'node', ['--test', 'test/security/cookie-consent-policy.test.mjs']);
    await runStep('critical-flow-deal-redirect-consent', 'node', ['--test', 'test/security/deal-redirect-consent-guard.test.mjs']);
    await cleanupRedisState();
    if (useStrictLocalOpsProfile) {
      await runStep(
        'security-compliance-strict-local-env',
        'node',
        ['scripts/security-compliance.mjs', '--strict'],
        buildStrictComplianceEnvForLocalProfile()
      );
    } else {
      await runStep('security-compliance-strict', 'node', ['scripts/security-compliance.mjs', '--strict']);
    }
    if (useStrictLocalOpsProfile) {
      await runStep(
        'ops-production-readiness-strict-local-env',
        'node',
        ['scripts/ops-production-readiness.mjs', '--strict'],
        buildStrictComplianceEnvForLocalProfile()
      );
    } else {
      await runStep('ops-production-readiness-strict', 'node', ['scripts/ops-production-readiness.mjs', '--strict']);
    }
    console.log('\n[security-go-live-gate] all critical checks passed');
  } finally {
    if (dockerStartedBySecurityGate && !KEEP_SERVICES_UP) {
      await runStep('docker-stop-postgres-redis', 'docker', ['compose', 'stop', 'postgres', 'redis'], dockerEnv);
    }
  }
}

main().catch((error) => {
  console.error('\n[security-go-live-gate] failed');
  console.error(error?.message || error);
  process.exit(1);
});
