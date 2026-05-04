import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import { resolve } from 'node:path';

const LOCAL_DATABASE_URL = process.env.SECURITY_COMPLIANCE_LOCAL_DATABASE_URL || 'postgresql://flight:flight@127.0.0.1:5432/flight';
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
    const child =
      process.platform === 'win32'
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
      console.log(`[ready] ${name} reachable on ${endpoint.host}:${endpoint.port} (attempt ${attempt}/${attempts})`);
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
  throw new Error(`${name} not reachable on ${endpoint.host}:${endpoint.port} after ${attempts} attempts`);
}

async function main() {
  await mkdir(LOCAL_DOCKER_CONFIG, { recursive: true });
  const dockerEnv = { ...process.env, DOCKER_CONFIG: LOCAL_DOCKER_CONFIG };
const strictEnv = {
    ...process.env,
    DATABASE_URL: LOCAL_DATABASE_URL,
    REDIS_URL: LOCAL_REDIS_URL,
    IP_HASH_SALT: process.env.IP_HASH_SALT || 'local_compliance_ip_salt_32_chars_min',
    BACKUP_ENCRYPTION_KEY: process.env.BACKUP_ENCRYPTION_KEY || 'local_compliance_backup_encryption_key_very_strong_123',
    DATA_RETENTION_AUTH_EVENTS_DAYS: process.env.DATA_RETENTION_AUTH_EVENTS_DAYS || '90',
    DATA_RETENTION_CLIENT_TELEMETRY_DAYS: process.env.DATA_RETENTION_CLIENT_TELEMETRY_DAYS || '180',
    DATA_RETENTION_OUTBOUND_EVENTS_DAYS: process.env.DATA_RETENTION_OUTBOUND_EVENTS_DAYS || '180',
    LEGAL_COMPANY_NAME: process.env.LEGAL_COMPANY_NAME || 'Flight Suite S.r.l.',
    LEGAL_COMPANY_ADDRESS: process.env.LEGAL_COMPANY_ADDRESS || 'Via Torino 10, Milano, IT',
    LEGAL_PRIVACY_EMAIL: process.env.LEGAL_PRIVACY_EMAIL || 'privacy@flightsuite.it',
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.flightsuite.it',
    SMTP_PORT: process.env.SMTP_PORT || '587',
    SMTP_USER: process.env.SMTP_USER || 'noreply@flightsuite.it',
    SMTP_PASS: process.env.SMTP_PASS || 'secure_mail_password_1234',
    RL_LOGIN_ATTEMPTS_15M: process.env.RL_LOGIN_ATTEMPTS_15M || '250',
    RL_AUTH_PER_MINUTE: process.env.RL_AUTH_PER_MINUTE || '200',
    ALLOW_INSECURE_STARTUP_FOR_TESTS: process.env.ALLOW_INSECURE_STARTUP_FOR_TESTS || 'true',
    ALLOW_INSECURE_STARTUP_IN_PRODUCTION: process.env.ALLOW_INSECURE_STARTUP_IN_PRODUCTION || 'true',
    ALLOW_INSECURE_STARTUP_TEST_CONTEXT: process.env.ALLOW_INSECURE_STARTUP_TEST_CONTEXT || 'true',
    ENABLE_TRAVELPAYOUTS_AFFILIATE: process.env.ENABLE_TRAVELPAYOUTS_AFFILIATE || 'true',
    AFFILIATE_TRAVELPAYOUTS_MARKER: process.env.AFFILIATE_TRAVELPAYOUTS_MARKER || 'localtpmarker',
    SOFT_LAUNCH_AFFILIATE_PROFILE: process.env.SOFT_LAUNCH_AFFILIATE_PROFILE || 'true'
  };

  await assertDockerEngineAvailable(dockerEnv);
  await spawnStep('docker compose up -d postgres redis', DOCKER_BIN, ['compose', 'up', '-d', 'postgres', 'redis'], dockerEnv);
  const postgresEndpoint = parseHostPort(LOCAL_DATABASE_URL, 5432);
  const redisEndpoint = parseHostPort(LOCAL_REDIS_URL, 6379);
  if (!postgresEndpoint) throw new Error(`Invalid SECURITY_COMPLIANCE_LOCAL_DATABASE_URL: ${LOCAL_DATABASE_URL}`);
  if (!redisEndpoint) throw new Error(`Invalid SECURITY_COMPLIANCE_LOCAL_REDIS_URL: ${LOCAL_REDIS_URL}`);
  await waitForService('postgres', postgresEndpoint);
  await waitForService('redis', redisEndpoint);
  try {
    await spawnStep('security compliance strict', 'npm', ['run', 'test:security:compliance:strict'], strictEnv);
    console.log('\nsecurity-compliance-strict-local: PASS');
  } finally {
    if (!KEEP_SERVICES_UP) {
      await spawnStep('docker compose stop postgres redis', DOCKER_BIN, ['compose', 'stop', 'postgres', 'redis'], dockerEnv);
    }
  }
}

main().catch((error) => {
  console.error('\nsecurity-compliance-strict-local: FAIL');
  console.error(error?.message || error);
  process.exit(1);
});
