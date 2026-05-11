import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import Redis from 'ioredis';
import pg from 'pg';

const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
const WSL_BIN = process.env.WSL_BIN || 'wsl';
const WSL_DISTRO = String(process.env.WSL_DISTRO || '').trim();
const HEALTHCHECK_TIMEOUT_MS = Math.max(1_000, Number(process.env.INFRA_HEALTHCHECK_TIMEOUT_MS || 10_000));
const INFRA_READY_ATTEMPTS = Math.max(1, Number(process.env.INFRA_READY_ATTEMPTS || 12));
const INFRA_READY_DELAY_MS = Math.max(250, Number(process.env.INFRA_READY_DELAY_MS || 5_000));

export const LOCAL_DATABASE_URL = 'postgresql://flight:flight@127.0.0.1:5432/flight';
export const LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';
let cachedWslDockerHost = null;

let selectedController = null;
let migrationsDone = false;

function resolveInfraUrls({ mode, databaseUrl, redisUrl } = {}) {
  const normalizedMode = normalizeInfraMode(mode || process.env.INFRA_MODE || 'auto');
  if (normalizedMode === 'external') {
    const db = String(databaseUrl || process.env.DATABASE_URL || '').trim();
    const redis = String(redisUrl || process.env.REDIS_URL || '').trim();
    return { databaseUrl: db, redisUrl: redis, mode: normalizedMode };
  }
  if (normalizedMode === 'wsl-docker') {
    const host = resolveWslDockerHost();
    return {
      databaseUrl: `postgresql://flight:flight@${host}:5432/flight`,
      redisUrl: `redis://${host}:6379`,
      mode: normalizedMode
    };
  }
  return {
    databaseUrl: LOCAL_DATABASE_URL,
    redisUrl: LOCAL_REDIS_URL,
    mode: normalizedMode
  };
}

function resolveWslDockerHost() {
  if (cachedWslDockerHost) return cachedWslDockerHost;
  const override = String(process.env.WSL_DOCKER_HOST || '').trim();
  if (override) {
    cachedWslDockerHost = override;
    return cachedWslDockerHost;
  }
  const probe = runWslShellCapture('hostname -I');
  if ((probe.status ?? 1) === 0) {
    const host = String(probe.stdout || '')
      .trim()
      .split(/\s+/)
      .find(Boolean);
    if (host) {
      cachedWslDockerHost = host;
      return cachedWslDockerHost;
    }
  }
  cachedWslDockerHost = '127.0.0.1';
  return cachedWslDockerHost;
}

function normalizeInfraMode(value) {
  const normalized = String(value || 'auto').trim().toLowerCase();
  if (['auto', 'docker-desktop', 'wsl-docker', 'external'].includes(normalized)) return normalized;
  throw new Error(`invalid_infra_mode:${value}`);
}

function summarizeCommandError(errorOrText) {
  return String(errorOrText?.stderr || errorOrText?.stdout || errorOrText?.message || errorOrText || '').trim();
}

function getWslPrefixArgs() {
  return WSL_DISTRO ? ['-d', WSL_DISTRO, '--'] : [];
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function getWslProjectPath() {
  const windowsPath = process.cwd().replaceAll('\\', '/');
  const result = spawnSync(WSL_BIN, [...getWslPrefixArgs(), 'wslpath', '-a', windowsPath], {
    encoding: 'utf8',
    shell: false
  });
  if ((result.status ?? 1) !== 0) {
    const error = new Error('wsl_path_resolution_failed');
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return String(result.stdout || '').trim();
}

function makeWslStep(name, command) {
  const wslProjectPath = getWslProjectPath();
  return {
    name,
    cmd: WSL_BIN,
    args: [...getWslPrefixArgs(), 'sh', '-lc', `cd ${shellQuote(wslProjectPath)} && ${command}`]
  };
}

function startWslKeepAlive() {
  const child = spawn(WSL_BIN, [...getWslPrefixArgs(), 'sh', '-lc', 'while true; do sleep 3600; done'], {
    stdio: 'ignore',
    shell: false,
    windowsHide: true
  });
  child.unref?.();
  return child;
}

function stopWslKeepAlive(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
}

function runWslShellCapture(command) {
  return spawnSync(WSL_BIN, [...getWslPrefixArgs(), 'sh', '-lc', command], {
    encoding: 'utf8',
    shell: false
  });
}

function commandForWindows(step) {
  return `${step.cmd} ${step.args.map((arg) => String(arg)).join(' ')}`;
}

export function runStep(step, options = {}) {
  return new Promise((resolve, reject) => {
    const needsWindowsCmdShim = process.platform === 'win32' && /^(npm|npx)$/i.test(step.cmd);
    const child = needsWindowsCmdShim
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandForWindows(step)], {
          stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
          shell: false,
          env: options.env || process.env,
          windowsHide: true
        })
      : spawn(step.cmd, step.args, {
          stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
          shell: false,
          env: options.env || process.env,
          windowsHide: true
        });

    let stdout = '';
    let stderr = '';
    if (options.capture) {
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
    }
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr, code });
      else {
        const error = new Error(`step_failed:${step.name}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });
    child.on('error', reject);
  });
}

async function withTimeout(label, promiseFactory, timeoutMs = HEALTHCHECK_TIMEOUT_MS) {
  const timeout = delay(timeoutMs).then(() => {
    throw new Error(`${label} timed out after ${timeoutMs}ms`);
  });
  return Promise.race([promiseFactory(), timeout]);
}

export async function checkPostgres(databaseUrl) {
  const url = String(databaseUrl || '').trim();
  if (!url) throw new Error('DATABASE_URL is required for Postgres healthcheck.');
  const pool = new pg.Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: HEALTHCHECK_TIMEOUT_MS,
    idleTimeoutMillis: 1_000
  });
  pool.on('error', () => {});
  try {
    await withTimeout('Postgres healthcheck', async () => {
      const client = await pool.connect();
      try {
        await client.query('select 1 as ok');
      } finally {
        client.release();
      }
    });
    console.log('[test-infra] postgres healthcheck: PASS');
  } catch (error) {
    throw new Error(`postgres_healthcheck_failed:${error?.message || error}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function checkRedis(redisUrl) {
  const url = String(redisUrl || '').trim();
  if (!url) throw new Error('REDIS_URL is required for Redis healthcheck.');
  const redis = new Redis(url, {
    connectTimeout: HEALTHCHECK_TIMEOUT_MS,
    commandTimeout: HEALTHCHECK_TIMEOUT_MS,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: null
  });
  try {
    await withTimeout('Redis healthcheck', async () => {
      await redis.connect();
      const pong = await redis.ping();
      if (pong !== 'PONG') throw new Error(`unexpected ping response: ${pong}`);
    });
    console.log('[test-infra] redis healthcheck: PASS');
  } catch (error) {
    throw new Error(`redis_healthcheck_failed:${error?.message || error}`);
  } finally {
    redis.disconnect();
  }
}

async function waitForInfraHealth({ databaseUrl, redisUrl }) {
  let lastError = null;
  for (let attempt = 1; attempt <= INFRA_READY_ATTEMPTS; attempt += 1) {
    try {
      await checkPostgres(databaseUrl);
      await checkRedis(redisUrl);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === INFRA_READY_ATTEMPTS) break;
      console.warn(`[test-infra] healthcheck not ready (${attempt}/${INFRA_READY_ATTEMPTS}): ${error?.message || error}`);
      await delay(INFRA_READY_DELAY_MS);
    }
  }
  throw lastError || new Error('infra_healthcheck_failed');
}

function assertDockerDesktopAvailable() {
  const result = spawnSync(DOCKER_BIN, ['info'], { encoding: 'utf8', shell: false });
  if ((result.status ?? 1) === 0) return;
  const error = new Error('docker_desktop_unavailable');
  error.stdout = result.stdout;
  error.stderr = result.stderr;
  throw error;
}

function assertWslDockerEngineAvailable() {
  const dockerPath = runWslShellCapture('command -v docker');
  if ((dockerPath.status ?? 1) !== 0) {
    const error = new Error('wsl_docker_cli_not_found');
    error.stdout = dockerPath.stdout;
    error.stderr = dockerPath.stderr;
    throw error;
  }

  const dockerPathText = String(dockerPath.stdout || '').trim();
  if (/\/mnt\/wsl\/docker-desktop/i.test(dockerPathText) || /\/mnt\/c\/.*docker/i.test(dockerPathText)) {
    throw new Error(`wsl_docker_points_to_docker_desktop:${dockerPathText}`);
  }

  const dockerInfo = runWslShellCapture("docker info --format 'name={{.Name}} os={{.OperatingSystem}} root={{.DockerRootDir}}'");
  if ((dockerInfo.status ?? 1) !== 0) {
    const error = new Error('wsl_docker_engine_unavailable');
    error.stdout = dockerInfo.stdout;
    error.stderr = dockerInfo.stderr;
    throw error;
  }
  const infoText = String(dockerInfo.stdout || dockerInfo.stderr || '').trim();
  if (/Docker Desktop|docker-desktop/i.test(infoText)) {
    throw new Error(`wsl_docker_uses_docker_desktop_backend:${infoText}`);
  }
}

async function startDockerDesktopInfra(urls) {
  try {
    await checkPostgres(urls.databaseUrl);
    await checkRedis(urls.redisUrl);
    return {
      startedByGate: false,
      stop: async () => {}
    };
  } catch {}
  assertDockerDesktopAvailable();
  console.log('\n[test-infra] infra: docker-desktop');
  await runStep({ name: 'docker-desktop-up-postgres-redis', cmd: DOCKER_BIN, args: ['compose', 'up', '-d', 'postgres', 'redis'] });
  await waitForInfraHealth(urls);
  return {
    startedByGate: true,
    stop: () => runStep({ name: 'docker-desktop-stop-postgres-redis', cmd: DOCKER_BIN, args: ['compose', 'stop', 'postgres', 'redis'] })
  };
}

async function startWslDockerInfra(urls) {
  console.log('\n[test-infra] infra: wsl-docker');
  assertWslDockerEngineAvailable();
  const keepAlive = startWslKeepAlive();
  try {
    await checkPostgres(urls.databaseUrl);
    await checkRedis(urls.redisUrl);
    return {
      startedByGate: false,
      stop: async () => {
        stopWslKeepAlive(keepAlive);
      }
    };
  } catch {}
  await runStep(makeWslStep('wsl-docker-up-postgres-redis', 'docker compose up -d postgres redis'));
  try {
    await waitForInfraHealth(urls);
    return {
      startedByGate: true,
      stop: async () => {
        try {
          await runStep(makeWslStep('wsl-docker-stop-postgres-redis', 'docker compose stop postgres redis'));
        } finally {
          stopWslKeepAlive(keepAlive);
        }
      }
    };
  } catch (error) {
    stopWslKeepAlive(keepAlive);
    throw error;
  }
}

async function useExistingInfra(urls, { requireExplicitUrls = false } = {}) {
  if (requireExplicitUrls && (!process.env.DATABASE_URL || !process.env.REDIS_URL)) {
    throw new Error('external_infra_requires_DATABASE_URL_and_REDIS_URL');
  }
  console.log('\n[test-infra] infra: existing/external');
  await waitForInfraHealth(urls);
  return {
    startedByGate: false,
    stop: async () => {}
  };
}

function printInfraFailureGuidance(failures) {
  console.error('\n[test-infra] No valid infrastructure mode is available.');
  console.error('[test-infra] Postgres and Redis were not skipped; real healthchecks are required.');
  for (const failure of failures) {
    console.error(`- ${failure.mode}: ${failure.message}`);
  }
  console.error('\n[test-infra] Try one of:');
  console.error('- INFRA_MODE=auto npm test');
  console.error('- INFRA_MODE=docker-desktop npm test');
  console.error('- INFRA_MODE=wsl-docker npm test');
  console.error('- DATABASE_URL=... REDIS_URL=... INFRA_MODE=external npm test');
}

export function buildTestSafeEnv(baseEnv = process.env, urls = {}) {
  const mode = normalizeInfraMode(baseEnv.INFRA_MODE || 'auto');
  const wslUrls = mode === 'wsl-docker' ? resolveInfraUrls({ mode: 'wsl-docker' }) : null;
  const databaseUrl =
    mode === 'external'
      ? String(urls.databaseUrl || baseEnv.DATABASE_URL || LOCAL_DATABASE_URL).trim()
      : mode === 'wsl-docker'
      ? String(urls.databaseUrl || wslUrls.databaseUrl).trim()
      : String(urls.databaseUrl || LOCAL_DATABASE_URL).trim();
  const redisUrl =
    mode === 'external'
      ? String(urls.redisUrl || baseEnv.REDIS_URL || LOCAL_REDIS_URL).trim()
      : mode === 'wsl-docker'
      ? String(urls.redisUrl || wslUrls.redisUrl).trim()
      : String(urls.redisUrl || LOCAL_REDIS_URL).trim();
  return {
    ...baseEnv,
    NODE_ENV: baseEnv.NODE_ENV || 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    SECURITY_COMPLIANCE_LOCAL_DATABASE_URL: String(baseEnv.SECURITY_COMPLIANCE_LOCAL_DATABASE_URL || databaseUrl).trim(),
    SECURITY_COMPLIANCE_LOCAL_REDIS_URL: String(baseEnv.SECURITY_COMPLIANCE_LOCAL_REDIS_URL || redisUrl).trim(),
    EMAIL_DRY_RUN: 'true',
    SMTP_HOST: baseEnv.SMTP_HOST || '',
    SMTP_USER: baseEnv.SMTP_USER || '',
    SMTP_PASS: baseEnv.SMTP_PASS || '',
    ENABLE_PROVIDER_DUFFEL: baseEnv.ENABLE_PROVIDER_DUFFEL || 'false',
    ENABLE_PROVIDER_KIWI: baseEnv.ENABLE_PROVIDER_KIWI || 'false',
    AI_ALLOW_FREE_USERS: 'false',
    AI_ALLOWED_PLAN_TYPES: baseEnv.AI_ALLOWED_PLAN_TYPES || 'pro,creator',
    FREE_AI_ENABLED: 'false',
    ALLOW_MOCK_BILLING_UPGRADES: 'false'
  };
}

export async function ensureTestInfra(options = {}) {
  const resolved = resolveInfraUrls({
    mode: options.mode || process.env.INFRA_MODE || 'auto',
    databaseUrl: options.databaseUrl,
    redisUrl: options.redisUrl
  });
  const { mode } = resolved;
  let urls = { databaseUrl: resolved.databaseUrl, redisUrl: resolved.redisUrl };
  if (selectedController) return { ...urls, controller: selectedController };

  console.log(`[test-infra] INFRA_MODE=${mode}`);
  const failures = [];
  const tryMode = async (name, factory) => {
    try {
      selectedController = await factory();
      console.log(`[test-infra] infra mode selected: ${name}`);
      return true;
    } catch (error) {
      const message = summarizeCommandError(error) || error?.message || String(error);
      failures.push({ mode: name, message });
      console.warn(`[test-infra] infra mode failed: ${name} :: ${message}`);
      return false;
    }
  };

  if (mode === 'external') {
    await tryMode('external', () => useExistingInfra(urls, { requireExplicitUrls: true }));
  } else if (mode === 'docker-desktop') {
    await tryMode('docker-desktop', () => startDockerDesktopInfra(urls));
  } else if (mode === 'wsl-docker') {
    urls = resolveInfraUrls({ mode: 'wsl-docker' });
    await tryMode('wsl-docker', () => startWslDockerInfra(urls));
  } else {
    if (process.platform === 'win32') {
      const wslUrls = resolveInfraUrls({ mode: 'wsl-docker' });
      if (await tryMode('wsl-docker', () => startWslDockerInfra(wslUrls))) {
        urls = wslUrls;
        return { ...urls, controller: selectedController };
      }
    }
    if (await tryMode('docker-desktop', () => startDockerDesktopInfra(urls))) return { ...urls, controller: selectedController };
    const wslUrls = resolveInfraUrls({ mode: 'wsl-docker' });
    if (process.platform !== 'win32' && (await tryMode('wsl-docker', () => startWslDockerInfra(wslUrls)))) {
      urls = wslUrls;
      return { ...urls, controller: selectedController };
    }
    if (await tryMode('existing-services', () => useExistingInfra(urls))) return { ...urls, controller: selectedController };
  }

  if (!selectedController) {
    printInfraFailureGuidance(failures);
    throw new Error('infra_unavailable');
  }
  return { ...urls, controller: selectedController };
}

export async function ensureTestMigrations(env = process.env) {
  if (migrationsDone) return;
  console.log('\n[test-infra] running: db-migrate');
  await runStep({ name: 'db-migrate', cmd: 'node', args: ['scripts/db-migrate.mjs'] }, { env });
  migrationsDone = true;
}

export async function stopTestInfra() {
  if (!selectedController) return;
  if (selectedController.startedByGate) {
    console.log('\n[test-infra] running: infra-stop-postgres-redis');
  }
  try {
    await selectedController.stop();
  } finally {
    selectedController = null;
  }
}
