import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import Redis from 'ioredis';
import pg from 'pg';

const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
const WSL_BIN = process.env.WSL_BIN || 'wsl';
const WSL_DISTRO = String(process.env.WSL_DISTRO || '').trim();
const INFRA_MODE = normalizeInfraMode(process.env.INFRA_MODE || 'auto');
const ALLOW_DOCKER_DESKTOP_FALLBACK = String(process.env.ALLOW_DOCKER_DESKTOP_FALLBACK || '').trim().toLowerCase() === 'true';
const HEALTHCHECK_TIMEOUT_MS = 10_000;
const INFRA_READY_ATTEMPTS = Math.max(1, Number(process.env.INFRA_READY_ATTEMPTS || 12));
const INFRA_READY_DELAY_MS = Math.max(250, Number(process.env.INFRA_READY_DELAY_MS || 5_000));
const LOCAL_DATABASE_URL = 'postgresql://flight:flight@127.0.0.1:5432/flight';
const LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';
const effectiveDatabaseUrl = String(process.env.DATABASE_URL || LOCAL_DATABASE_URL).trim();
const effectiveRedisUrl = String(process.env.REDIS_URL || LOCAL_REDIS_URL).trim();
const externalDatabaseUrl = String(process.env.DATABASE_URL || '').trim();
const externalRedisUrl = String(process.env.REDIS_URL || '').trim();
const dockerDesktopErrorPatterns = [
  /dockerDesktopLinuxEngine/i,
  /500 Internal Server Error/i,
  /daemon.*not.*running/i,
  /cannot connect to the docker daemon/i,
  /failed to connect to the docker API/i,
  /pipe\/docker_engine/i,
  /pipe\/dockerDesktopLinuxEngine/i
];

const steps = [
  { name: 'lint', cmd: 'npm', args: ['run', 'lint'] },
  { name: 'lint-providers', cmd: 'npm', args: ['run', 'lint:providers'] },
  { name: 'unit-tests', cmd: 'npm', args: ['test'] },
  { name: 'typed-tests', cmd: 'npm', args: ['run', 'test:unit'] },
  { name: 'security-go-live-gate', cmd: 'npm', args: ['run', 'test:security:go-live:gate'] },
  { name: 'compliance-check', cmd: 'npm', args: ['run', 'compliance:check'] },
  { name: 'build', cmd: 'npm', args: ['run', 'build'] }
];

if (String(process.env.RUN_DB_MIGRATION_AUDIT || '').trim().toLowerCase() === 'true') {
  steps.push({
    name: 'db-migration-status',
    cmd: 'npm',
    args: ['run', 'db:migrations:status']
  });
}

function normalizeInfraMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['auto', 'docker-desktop', 'wsl-docker', 'external'].includes(normalized)) return normalized;
  throw new Error(`invalid_infra_mode:${value}`);
}

function commandForWindows(step) {
  return `${step.cmd} ${step.args.map((arg) => String(arg)).join(' ')}`;
}

function runStep(step, options = {}) {
  return new Promise((resolve, reject) => {
    const needsWindowsCmdShim = process.platform === 'win32' && /^(npm|npx)$/i.test(step.cmd);
    const child =
      needsWindowsCmdShim
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandForWindows(step)], {
            stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
            shell: false,
            env: options.env || process.env
          })
        : spawn(step.cmd, step.args, {
            stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
            shell: false,
            env: options.env || process.env
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

function runSyncCapture(cmd, args, env = process.env) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: false,
    env
  });
}

function summarizeCommandError(error) {
  return String(error?.stderr || error?.stdout || error?.message || error || '').trim();
}

function isDockerDesktopUnavailable(errorOrText) {
  const text = summarizeCommandError(errorOrText);
  return dockerDesktopErrorPatterns.some((pattern) => pattern.test(text));
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
  try {
    await withTimeout('Postgres healthcheck', async () => {
      const client = await pool.connect();
      try {
        await client.query('select 1 as ok');
      } finally {
        client.release();
      }
    });
    console.log('[release-prod-gate] postgres healthcheck: PASS');
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
    console.log('[release-prod-gate] redis healthcheck: PASS');
  } catch (error) {
    throw new Error(`redis_healthcheck_failed:${error?.message || error}`);
  } finally {
    redis.disconnect();
  }
}

async function checkInfraHealth({ databaseUrl = effectiveDatabaseUrl, redisUrl = effectiveRedisUrl } = {}) {
  await checkPostgres(databaseUrl);
  await checkRedis(redisUrl);
}

async function waitForInfraHealth(options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= INFRA_READY_ATTEMPTS; attempt += 1) {
    try {
      await checkInfraHealth(options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === INFRA_READY_ATTEMPTS) break;
      console.warn(
        `[release-prod-gate] infra healthcheck not ready (${attempt}/${INFRA_READY_ATTEMPTS}): ${error?.message || error}`
      );
      await delay(INFRA_READY_DELAY_MS);
    }
  }
  throw lastError || new Error('infra_healthcheck_failed');
}

function assertDockerDesktopAvailable() {
  const result = runSyncCapture(DOCKER_BIN, ['info']);
  if ((result.status ?? 1) === 0) return;

  const details = String(result.stderr || result.stdout || '').trim();
  const error = new Error('docker_desktop_unavailable');
  error.stdout = result.stdout;
  error.stderr = result.stderr;
  error.details = details;
  throw error;
}

function getWslPrefixArgs() {
  return WSL_DISTRO ? ['-d', WSL_DISTRO, '--'] : [];
}

function getWindowsPathForWslpath() {
  return process.cwd().replaceAll('\\', '/');
}

function getWslProjectPath() {
  const args = [...getWslPrefixArgs(), 'wslpath', '-a', getWindowsPathForWslpath()];
  const result = runSyncCapture(WSL_BIN, args);
  if ((result.status ?? 1) !== 0) {
    const error = new Error('wsl_path_resolution_failed');
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return String(result.stdout || '').trim();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function makeWslStep(name, command) {
  const wslProjectPath = getWslProjectPath();
  return {
    name,
    cmd: WSL_BIN,
    args: [...getWslPrefixArgs(), 'sh', '-lc', `cd ${shellQuote(wslProjectPath)} && ${command}`]
  };
}

function runWslShellCapture(command) {
  return runSyncCapture(WSL_BIN, [...getWslPrefixArgs(), 'sh', '-lc', command]);
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

async function startDockerDesktopInfra() {
  assertDockerDesktopAvailable();
  console.log('\n[release-prod-gate] infra: docker-desktop');
  const stopStep = {
    name: 'docker-desktop-stop-postgres-redis',
    cmd: DOCKER_BIN,
    args: ['compose', 'stop', 'postgres', 'redis']
  };
  let started = false;
  await runStep({
    name: 'docker-desktop-up-postgres-redis',
    cmd: DOCKER_BIN,
    args: ['compose', 'up', '-d', 'postgres', 'redis']
  });
  started = true;
  try {
    await waitForInfraHealth();
  } catch (error) {
    if (started) await runStep(stopStep).catch(() => {});
    throw error;
  }
  return {
    startedByGate: true,
    stop: () => runStep(stopStep)
  };
}

async function startWslDockerInfra() {
  console.log('\n[release-prod-gate] infra: wsl-docker');
  assertWslDockerEngineAvailable();
  await runStep(makeWslStep('wsl-docker-info', 'docker info'));
  const stopStep = makeWslStep('wsl-docker-stop-postgres-redis', 'docker compose stop postgres redis');
  let started = false;
  await runStep(makeWslStep('wsl-docker-up-postgres-redis', 'docker compose up -d postgres redis'));
  started = true;
  try {
    await waitForInfraHealth();
  } catch (error) {
    if (started) await runStep(stopStep).catch(() => {});
    throw error;
  }
  return {
    startedByGate: true,
    stop: () => runStep(stopStep)
  };
}

async function useExternalInfra({ allowDefaults = false } = {}) {
  const databaseUrl = allowDefaults ? effectiveDatabaseUrl : externalDatabaseUrl;
  const redisUrl = allowDefaults ? effectiveRedisUrl : externalRedisUrl;
  if (!databaseUrl || !redisUrl) {
    throw new Error('external_infra_requires_DATABASE_URL_and_REDIS_URL');
  }
  console.log('\n[release-prod-gate] infra: external');
  await checkInfraHealth({ databaseUrl, redisUrl });
  return {
    startedByGate: false,
    stop: async () => {}
  };
}

function printInfraFailureGuidance(failures) {
  console.error('\n[release-prod-gate] No valid infrastructure mode is available.');
  console.error('[release-prod-gate] Required services were NOT skipped: Postgres and Redis must pass real healthchecks.');
  console.error('[release-prod-gate] Tried modes:');
  for (const failure of failures) {
    console.error(`- ${failure.mode}: ${failure.message}`);
  }
  console.error('\n[release-prod-gate] Windows options:');
  console.error('- Free/default path, WSL2 Docker Engine: npm run release:prod:gate:free');
  console.error('- WSL2 Docker Engine: npm run release:prod:gate:wsl');
  console.error('- Existing/local/external services: set DATABASE_URL and REDIS_URL, then npm run release:prod:gate:external');
  console.error('- Auto fallback: npm run release:prod:gate:auto');
  console.error('- Docker Desktop, optional only: npm run release:prod:gate:desktop');
  console.error('- Desktop fallback opt-in for auto: set ALLOW_DOCKER_DESKTOP_FALLBACK=true');
  console.error('\n[release-prod-gate] Docker Desktop is not required. Prefer WSL Docker Engine or external services to avoid Desktop licensing/runtime issues.');
}

const requiresLocalInfra = new Set(['unit-tests', 'typed-tests', 'security-go-live-gate']);
let infraController = null;

function readTrackedGitStatus() {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    encoding: 'utf8',
    shell: false
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`git_status_failed:${String(result.stderr || '').trim() || 'unknown'}`);
  }
  return new Set(
    String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

function diffNewTrackedChanges(beforeSet, afterSet) {
  const added = [];
  for (const line of afterSet) {
    if (!beforeSet.has(line)) added.push(line);
  }
  return added;
}

async function ensureLocalInfra() {
  if (infraController) return;
  console.log(`[release-prod-gate] INFRA_MODE=${INFRA_MODE}`);
  const failures = [];
  const tryMode = async (mode, factory) => {
    try {
      infraController = await factory();
      console.log(`[release-prod-gate] infra mode selected: ${mode}`);
      return true;
    } catch (error) {
      const message = summarizeCommandError(error) || error?.message || String(error);
      failures.push({ mode, message });
      console.warn(`[release-prod-gate] infra mode failed: ${mode} :: ${message}`);
      return false;
    }
  };

  if (INFRA_MODE === 'external') {
    if (await tryMode('external', () => useExternalInfra())) return;
  } else if (INFRA_MODE === 'docker-desktop') {
    if (await tryMode('docker-desktop', startDockerDesktopInfra)) return;
  } else if (INFRA_MODE === 'wsl-docker') {
    if (await tryMode('wsl-docker', startWslDockerInfra)) return;
  } else {
    if (await tryMode('existing-services', () => useExternalInfra({ allowDefaults: true }))) return;
    if (await tryMode('wsl-docker', startWslDockerInfra)) return;
    if (ALLOW_DOCKER_DESKTOP_FALLBACK) {
      const desktopOk = await tryMode('docker-desktop', startDockerDesktopInfra);
      if (desktopOk) return;
      const desktopFailure = failures.find((failure) => failure.mode === 'docker-desktop');
      if (desktopFailure && isDockerDesktopUnavailable(desktopFailure.message)) {
        console.warn('[release-prod-gate] Docker Desktop looks unhealthy; use WSL Docker Engine or external services.');
      }
    } else {
      console.warn('[release-prod-gate] auto mode did not try Docker Desktop because ALLOW_DOCKER_DESKTOP_FALLBACK is not true.');
    }
  }

  printInfraFailureGuidance(failures);
  throw new Error('step_failed:infra-unavailable');
}

async function stopLocalInfra() {
  if (!infraController) return;
  if (!infraController.startedByGate) return;
  console.log('\n[release-prod-gate] running: infra-stop-postgres-redis');
  try {
    await infraController.stop();
  } finally {
    infraController = null;
  }
}

try {
  const gitStatusBefore = readTrackedGitStatus();
  for (const step of steps) {
    if (requiresLocalInfra.has(step.name)) {
      await ensureLocalInfra();
    }
    // Keep output concise and searchable in CI logs.
    console.log(`\n[release-prod-gate] running: ${step.name}`);
    await runStep(step);
  }
  const gitStatusAfter = readTrackedGitStatus();
  const newTrackedChanges = diffNewTrackedChanges(gitStatusBefore, gitStatusAfter);
  if (newTrackedChanges.length > 0) {
    console.error('[release-prod-gate] new tracked files modified during pipeline');
    for (const line of newTrackedChanges.slice(0, 50)) {
      console.error(`- ${line}`);
    }
    throw new Error('step_failed:git-clean-delta');
  }
  console.log('[release-prod-gate] git tracked delta check passed');
  console.log('\n[release-prod-gate] all checks passed');
} finally {
  await stopLocalInfra();
}
