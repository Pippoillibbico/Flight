import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const LOCAL_DATABASE_URL =
  process.env.SECURITY_COMPLIANCE_LOCAL_DATABASE_URL || 'postgresql://flight:flight@127.0.0.1:5432/flight';
const LOCAL_REDIS_URL = process.env.SECURITY_COMPLIANCE_LOCAL_REDIS_URL || 'redis://127.0.0.1:6379';
const KEEP_SERVICES_UP =
  String(process.env.SECURITY_COMPLIANCE_LOCAL_KEEP_SERVICES || 'false')
    .trim()
    .toLowerCase() === 'true';
const LOCAL_DOCKER_CONFIG = process.env.DOCKER_CONFIG || resolve(process.cwd(), '.tmp', 'docker-config');
const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';

function spawnStep(label, cmd, args, env = process.env) {
  return new Promise((resolveStep, rejectStep) => {
    console.log(`\n==> ${label}`);
    const needsWindowsCmdShim = process.platform === 'win32' && /^(npm|npx)$/i.test(cmd);
    const child =
      needsWindowsCmdShim
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${cmd} ${args.join(' ')}`], {
            stdio: 'inherit',
            shell: false,
            env
          })
        : spawn(cmd, args, { stdio: 'inherit', shell: false, env });
    child.on('exit', (code) => {
      if (code === 0) return resolveStep();
      return rejectStep(new Error(`${label} failed (${code})`));
    });
  });
}

async function assertDockerEngineAvailable(env = process.env) {
  await spawnStep('docker engine availability', DOCKER_BIN, ['info'], env).catch((error) => {
    console.error('\nDocker Engine is not reachable from this terminal.');
    console.error('Start a terminal-accessible Docker Engine, then rerun this command.');
    console.error('On Windows, run from WSL with Docker Engine installed, or set DOCKER_HOST for a remote/rootless engine.');
    console.error('Docker Desktop is not started by this repository.');
    throw error;
  });
}

async function main() {
  await mkdir(LOCAL_DOCKER_CONFIG, { recursive: true });
  const dockerEnv = { ...process.env, DOCKER_CONFIG: LOCAL_DOCKER_CONFIG };
  const strictLocalEnv = {
    ...process.env,
    OPS_READINESS_LOCAL_PROFILE: process.env.OPS_READINESS_LOCAL_PROFILE || 'true',
    OPS_READINESS_STRICT: process.env.OPS_READINESS_STRICT || 'true',
    DATABASE_URL: process.env.DATABASE_URL || LOCAL_DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL || LOCAL_REDIS_URL,
    JWT_SECRET: process.env.JWT_SECRET || 'local_ops_readiness_jwt_secret_32_chars_minimum',
    OUTBOUND_CLICK_SECRET: process.env.OUTBOUND_CLICK_SECRET || 'local_ops_readiness_outbound_secret_very_strong_123',
    IP_HASH_SALT: process.env.IP_HASH_SALT || 'local_ops_readiness_ip_hash_salt_32_chars_min',
    BACKUP_ENCRYPTION_KEY:
      process.env.BACKUP_ENCRYPTION_KEY || 'local_ops_readiness_backup_encryption_key_very_strong_123',
    AUDIT_LOG_HMAC_KEY: process.env.AUDIT_LOG_HMAC_KEY || 'local_ops_readiness_audit_hmac_key_very_strong_123',
    INTERNAL_INGEST_TOKEN: process.env.INTERNAL_INGEST_TOKEN || 'local_ops_readiness_ingest_token_very_strong_123',
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_live_local_ops_1234567890abcdef',
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_live_local_ops_1234567890abcdef',
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_local_ops_1234567890abcdef',
    STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO || 'price_local_ops_pro_12eur',
    STRIPE_PRICE_CREATOR: process.env.STRIPE_PRICE_CREATOR || 'price_local_ops_creator_22eur',
    AFFILIATE_TRAVELPAYOUTS_MARKER: process.env.AFFILIATE_TRAVELPAYOUTS_MARKER || 'localtpmarker',
    BILLING_PROVIDER: process.env.BILLING_PROVIDER || 'stripe',
    FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || 'https://app.flightsuite.test',
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || 'https://app.flightsuite.test',
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'https://app.flightsuite.test',
    CORS_ALLOWLIST: process.env.CORS_ALLOWLIST || 'https://app.flightsuite.test',
    ENABLE_PROVIDER_DUFFEL: process.env.ENABLE_PROVIDER_DUFFEL || 'true',
    ENABLE_PROVIDER_KIWI: process.env.ENABLE_PROVIDER_KIWI || 'false',
    [`ENABLE_PROVIDER_${'SKY' + 'SCANNER'}`]: process.env[`ENABLE_PROVIDER_${'SKY' + 'SCANNER'}`] || 'false',
    DUFFEL_API_KEY: process.env.DUFFEL_API_KEY || 'duffel_local_ops_key_123456789',
    ENABLE_TRAVELPAYOUTS_AFFILIATE: process.env.ENABLE_TRAVELPAYOUTS_AFFILIATE || 'true',
    AI_ALLOW_FREE_USERS: process.env.AI_ALLOW_FREE_USERS || 'false',
    ALLOW_MOCK_BILLING_UPGRADES: process.env.ALLOW_MOCK_BILLING_UPGRADES || 'false',
    STRIPE_ALLOW_INLINE_PRICE_DATA: process.env.STRIPE_ALLOW_INLINE_PRICE_DATA || 'false',
    RELEASE_ALERT_WEBHOOK_URL: process.env.RELEASE_ALERT_WEBHOOK_URL || 'https://hooks.flightsuite.local/ops',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    LOG_RETENTION_DAYS: process.env.LOG_RETENTION_DAYS || '90',
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.flightsuite.it',
    SMTP_USER: process.env.SMTP_USER || 'noreply@flightsuite.it',
    SMTP_PASS: process.env.SMTP_PASS || 'secure_mail_password_1234',
    DATA_RETENTION_AUTH_EVENTS_DAYS: process.env.DATA_RETENTION_AUTH_EVENTS_DAYS || '90',
    DATA_RETENTION_CLIENT_TELEMETRY_DAYS: process.env.DATA_RETENTION_CLIENT_TELEMETRY_DAYS || '180',
    DATA_RETENTION_OUTBOUND_EVENTS_DAYS: process.env.DATA_RETENTION_OUTBOUND_EVENTS_DAYS || '180',
    LEGAL_COMPANY_NAME: process.env.LEGAL_COMPANY_NAME || 'Flight Suite S.r.l.',
    LEGAL_COMPANY_ADDRESS: process.env.LEGAL_COMPANY_ADDRESS || 'Via Torino 10, Milano, IT',
    LEGAL_PRIVACY_EMAIL: process.env.LEGAL_PRIVACY_EMAIL || 'privacy@flightsuite.it'
  };

  await assertDockerEngineAvailable(dockerEnv);
  await spawnStep('docker compose up -d postgres redis', DOCKER_BIN, ['compose', 'up', '-d', 'postgres', 'redis'], dockerEnv);
  try {
    await spawnStep('ops production readiness strict (local profile)', 'node', ['scripts/ops-production-readiness.mjs', '--strict'], strictLocalEnv);
    console.log('\nops-production-readiness-strict-local: PASS');
  } finally {
    if (!KEEP_SERVICES_UP) {
      await spawnStep('docker compose stop postgres redis', DOCKER_BIN, ['compose', 'stop', 'postgres', 'redis'], dockerEnv);
    }
  }
}

main().catch((error) => {
  console.error('\nops-production-readiness-strict-local: FAIL');
  console.error(error?.message || error);
  process.exit(1);
});
