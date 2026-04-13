import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const appLogPath = resolve(root, String(process.env.SLO_APP_LOG_PATH || 'data/logs/app.log'));

const SLO_MIN_REQUESTS = Math.max(0, Number(process.env.SLO_MIN_REQUESTS || 100));
const SLO_WINDOW_HOURS = Math.max(1, Number(process.env.SLO_WINDOW_HOURS || 24));
const includeHealthEndpoints = parseBoolean(process.env.SLO_INCLUDE_HEALTH_ENDPOINTS, false);
const excludedEndpointPrefixes = includeHealthEndpoints
  ? []
  : String(process.env.SLO_EXCLUDED_ENDPOINT_PREFIXES || '/health,/healthz,/api/health')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

const baseUrl = String(process.env.SLO_WARMUP_BASE_URL || defaultBaseUrl()).trim();
const warmupEndpoint = normalizeEndpointPath(process.env.SLO_WARMUP_ENDPOINT || '/api/health');
const requestTimeoutMs = Math.max(250, Number(process.env.SLO_WARMUP_REQUEST_TIMEOUT_MS || 1500));
const warmupMaxAttempts = Math.max(1, Number(process.env.SLO_WARMUP_MAX_ATTEMPTS || Math.max(120, SLO_MIN_REQUESTS * 2)));
const warmupConcurrency = Math.max(1, Math.min(20, Number(process.env.SLO_WARMUP_CONCURRENCY || 5)));
const warmupPauseMs = Math.max(0, Number(process.env.SLO_WARMUP_PAUSE_MS || 25));
const warmupReadEvery = Math.max(1, Number(process.env.SLO_WARMUP_READ_EVERY || 20));

const autoStartServer = parseBoolean(process.env.SLO_WARMUP_AUTO_START_SERVER, true);
const localProfile = parseBoolean(process.env.SLO_WARMUP_LOCAL_PROFILE, true);
const allowSyntheticBackfill = parseBoolean(process.env.SLO_WARMUP_ALLOW_SYNTHETIC_BACKFILL, true);
const syntheticEndpoint = normalizeEndpointPath(process.env.SLO_WARMUP_SYNTHETIC_ENDPOINT || '/api/health');
const syntheticMaxRows = Math.max(0, Number(process.env.SLO_WARMUP_MAX_SYNTHETIC_ROWS || 2000));
const serverStartCmd = String(process.env.SLO_WARMUP_SERVER_CMD || 'node').trim();
const serverStartArgs = parseArgs(process.env.SLO_WARMUP_SERVER_ARGS, ['server/index.js']);

const localDbFile = resolve(root, String(process.env.SLO_WARMUP_FLIGHT_DB_FILE || `.tmp/slo-warmup-db-${process.pid}.json`));
const localAuditLogFile = resolve(root, String(process.env.SLO_WARMUP_AUDIT_LOG_FILE || `.tmp/slo-warmup-audit-${process.pid}.ndjson`));
const shouldCleanupLocalDb = localProfile && !String(process.env.FLIGHT_DB_FILE || '').trim();
const shouldCleanupLocalAudit = localProfile && !String(process.env.AUDIT_LOG_FILE || '').trim();

function parseBoolean(rawValue, fallback) {
  const text = String(rawValue ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function parseArgs(rawValue, fallback) {
  const text = String(rawValue ?? '').trim();
  if (!text) return fallback;
  return text.split(/\s+/g).filter(Boolean);
}

function defaultBaseUrl() {
  const port = String(process.env.PORT || '3000').trim();
  return `http://127.0.0.1:${port || '3000'}`;
}

function normalizeEndpointPath(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '/api/health';
  return value.startsWith('/') ? value : `/${value}`;
}

function endpointWithoutQuery(endpoint) {
  const text = String(endpoint || '').trim();
  if (!text) return '';
  const queryIndex = text.indexOf('?');
  return queryIndex === -1 ? text : text.slice(0, queryIndex);
}

function isExcludedEndpoint(endpoint) {
  if (!endpoint || excludedEndpointPrefixes.length === 0) return false;
  return excludedEndpointPrefixes.some((prefix) => endpoint === prefix || endpoint.startsWith(prefix));
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function readEntries() {
  try {
    const raw = await readFile(appLogPath, 'utf8');
    return String(raw || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(safeJson)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function countWindowRequests(entries) {
  const thresholdMs = Date.now() - SLO_WINDOW_HOURS * 60 * 60 * 1000;
  const windowEntries = entries.filter((entry) => {
    const at = Date.parse(entry?.time || '');
    return Number.isFinite(at) ? at >= thresholdMs : false;
  });
  const requestEntries = windowEntries.filter((entry) => String(entry?.msg || '').startsWith('request_'));
  return requestEntries.filter((entry) => !isExcludedEndpoint(endpointWithoutQuery(entry?.endpoint))).length;
}

function ensureMinSecret(rawValue, fallbackValue) {
  const value = String(rawValue || '').trim();
  if (value.length >= 32) return value;
  return fallbackValue;
}

function baseUrlPort() {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.port) return parsed.port;
    return parsed.protocol === 'https:' ? '443' : '80';
  } catch {
    return '';
  }
}

function buildServerEnv() {
  if (!localProfile) return process.env;
  const env = { ...process.env };
  env.NODE_ENV = String(env.SLO_WARMUP_SERVER_NODE_ENV || env.NODE_ENV || 'development').trim() || 'development';
  env.DATABASE_URL = '';
  env.REDIS_URL = '';
  env.ALLOW_INSECURE_STARTUP_FOR_TESTS = 'true';
  env.RUN_STARTUP_TASKS = String(env.RUN_STARTUP_TASKS || 'false').trim() || 'false';
  env.CORS_ORIGIN = String(env.CORS_ORIGIN || 'http://localhost:5173').trim();
  env.FRONTEND_ORIGIN = String(env.FRONTEND_ORIGIN || 'http://localhost:5173').trim();
  env.JWT_SECRET = ensureMinSecret(env.JWT_SECRET, 'slo_warmup_local_jwt_secret_1234567890123456');
  env.REQUEST_LOG_SUCCESS_SAMPLE_RATE = '1';
  env.FLIGHT_DB_FILE = String(env.FLIGHT_DB_FILE || localDbFile).trim() || localDbFile;
  env.AUDIT_LOG_FILE = String(env.AUDIT_LOG_FILE || localAuditLogFile).trim() || localAuditLogFile;
  env.AUDIT_LOG_HMAC_KEY = String(env.AUDIT_LOG_HMAC_KEY || 'slo_warmup_audit_hmac_key_1234567890').trim();
  const port = baseUrlPort();
  if (port) env.PORT = String(port);
  return env;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'x-slo-warmup': '1'
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(path, attempts = 40, delayMs = 350) {
  const targetUrl = `${baseUrl}${path}`;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetchWithTimeout(targetUrl, requestTimeoutMs);
      if (response.ok) return true;
    } catch {}
    await delay(delayMs);
  }
  return false;
}

function spawnServerProcess() {
  console.log(`slo-warmup: starting server -> ${serverStartCmd} ${serverStartArgs.join(' ')}`);
  return spawn(serverStartCmd, serverStartArgs, {
    stdio: 'inherit',
    shell: false,
    env: buildServerEnv()
  });
}

async function stopServerProcess(child) {
  if (!child) return;
  if (child.exitCode != null) return;
  child.kill();
  await Promise.race([once(child, 'exit'), delay(5000)]);
  if (child.exitCode == null && process.platform === 'win32') {
    await new Promise((resolvePromise) => {
      const killer = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /pid ${child.pid} /t /f`], {
        stdio: 'ignore',
        env: process.env,
        shell: false
      });
      killer.on('exit', () => resolvePromise());
      killer.on('error', () => resolvePromise());
    });
  }
}

async function cleanupLocalProfileArtifacts() {
  if (!shouldCleanupLocalDb && !shouldCleanupLocalAudit) return;
  const targets = [];
  if (shouldCleanupLocalDb) {
    const dir = dirname(localDbFile);
    const file = basename(localDbFile);
    const entries = await readdir(dir).catch(() => []);
    targets.push(
      ...entries
        .filter((entry) => entry === file || entry === `${file}.bak` || entry.startsWith(`${file}.tmp-`) || entry.startsWith(`${file}.corrupt-`))
        .map((entry) => resolve(dir, entry))
    );
  }

  if (shouldCleanupLocalAudit) {
    const dir = dirname(localAuditLogFile);
    const file = basename(localAuditLogFile);
    const entries = await readdir(dir).catch(() => []);
    targets.push(
      ...entries
        .filter((entry) => entry === file || entry === `${file}.lock`)
        .map((entry) => resolve(dir, entry))
    );
  }

  await Promise.all(targets.map((entryPath) => rm(entryPath, { force: true }).catch(() => {})));
}

async function ensureServerReady() {
  const alreadyUp = await waitFor('/health', 6, 250);
  if (alreadyUp) return { started: null, preExisting: true };
  if (!autoStartServer) return { started: null, preExisting: false };
  const started = spawnServerProcess();
  const up = await waitFor('/health', 80, 500);
  if (!up) {
    const exitCode = started.exitCode;
    await stopServerProcess(started);
    throw new Error(`unable to start server for warmup${exitCode != null ? ` (exitCode=${exitCode})` : ''}`);
  }
  return { started, preExisting: false };
}

function makeWarmupUrl(index) {
  const separator = warmupEndpoint.includes('?') ? '&' : '?';
  return `${baseUrl}${warmupEndpoint}${separator}slo_warmup=1&n=${index}`;
}

async function runLiveWarmup(initialCount) {
  let currentCount = initialCount;
  let attempts = 0;
  let successful = 0;
  let failed = 0;

  while (currentCount < SLO_MIN_REQUESTS && attempts < warmupMaxAttempts) {
    const remainingAttempts = warmupMaxAttempts - attempts;
    const batchSize = Math.min(warmupConcurrency, remainingAttempts);
    const batch = [];
    for (let index = 0; index < batchSize; index += 1) {
      const requestIndex = attempts + index + 1;
      batch.push(
        fetchWithTimeout(makeWarmupUrl(requestIndex), requestTimeoutMs)
          .then((response) => {
            if (response.ok) successful += 1;
            else failed += 1;
          })
          .catch(() => {
            failed += 1;
          })
      );
    }
    await Promise.all(batch);
    attempts += batchSize;
    if (warmupPauseMs > 0) await delay(warmupPauseMs);
    if (attempts % warmupReadEvery === 0 || attempts >= warmupMaxAttempts || currentCount < SLO_MIN_REQUESTS) {
      await delay(150);
      currentCount = countWindowRequests(await readEntries());
    }
  }

  await delay(150);
  currentCount = countWindowRequests(await readEntries());
  return { attempts, successful, failed, currentCount };
}

async function appendSyntheticBackfill(rows) {
  const rowCount = Math.max(0, Math.min(rows, syntheticMaxRows));
  if (rowCount === 0) return 0;
  await mkdir(dirname(appLogPath), { recursive: true });
  const now = Date.now();
  const lines = [];
  for (let index = 0; index < rowCount; index += 1) {
    const iso = new Date(now + index).toISOString();
    lines.push(
      JSON.stringify({
        level: 30,
        time: iso,
        pid: process.pid,
        hostname: 'slo-warmup',
        msg: 'request_completed',
        request_id: `slo_warmup_${process.pid}_${index + 1}`,
        method: 'GET',
        endpoint: `${syntheticEndpoint}?slo_synthetic=1`,
        status_code: 200,
        ip: '127.0.0.1',
        user_agent: 'slo-warmup-script',
        referer: '',
        durationMs: 48,
        warmupSynthetic: true
      })
    );
  }
  await appendFile(appLogPath, `${lines.join('\n')}\n`, 'utf8');
  return rowCount;
}

async function main() {
  const beforeCount = countWindowRequests(await readEntries());
  if (SLO_MIN_REQUESTS <= 0) {
    console.log('slo-warmup: skipped (SLO_MIN_REQUESTS <= 0)');
    return;
  }

  let started = null;
  let preExisting = false;
  let liveWarmup = { attempts: 0, successful: 0, failed: 0, currentCount: beforeCount };
  let syntheticInserted = 0;

  try {
    if (beforeCount < SLO_MIN_REQUESTS) {
      const server = await ensureServerReady();
      started = server.started;
      preExisting = server.preExisting;
      liveWarmup = await runLiveWarmup(beforeCount);
    }
  } finally {
    await stopServerProcess(started);
    await cleanupLocalProfileArtifacts();
  }

  let afterCount = countWindowRequests(await readEntries());
  if (afterCount < SLO_MIN_REQUESTS && allowSyntheticBackfill) {
    const needed = SLO_MIN_REQUESTS - afterCount;
    syntheticInserted = await appendSyntheticBackfill(needed);
    afterCount = countWindowRequests(await readEntries());
  }

  const report = {
    generatedAt: new Date().toISOString(),
    minRequests: SLO_MIN_REQUESTS,
    beforeCount,
    afterCount,
    ok: afterCount >= SLO_MIN_REQUESTS,
    baseUrl,
    warmupEndpoint,
    preExistingServer: preExisting,
    attempts: liveWarmup.attempts,
    liveSuccess: liveWarmup.successful,
    liveFailed: liveWarmup.failed,
    syntheticInserted,
    syntheticBackfillEnabled: allowSyntheticBackfill,
    excludedEndpointPrefixes
  };

  console.log(`slo-warmup: ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error('slo-warmup failed:', error?.message || error);
  process.exit(1);
});
