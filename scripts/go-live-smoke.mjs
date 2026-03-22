import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const AUTO_START_SERVER = parseBoolean(process.env.SMOKE_AUTO_START_SERVER, true);
const LOCAL_PROFILE = parseBoolean(process.env.SMOKE_LOCAL_PROFILE, true);
const LOCAL_DB_FILE = resolve(process.cwd(), String(process.env.SMOKE_FLIGHT_DB_FILE || `.tmp/go-live-smoke-db-${process.pid}.json`));
const SHOULD_CLEAN_LOCAL_DB = LOCAL_PROFILE && !String(process.env.FLIGHT_DB_FILE || '').trim();
const LOCAL_AUDIT_LOG_FILE = resolve(
  process.cwd(),
  String(process.env.SMOKE_AUDIT_LOG_FILE || `.tmp/go-live-smoke-audit-${process.pid}.ndjson`)
);
const SHOULD_CLEAN_LOCAL_AUDIT = LOCAL_PROFILE && !String(process.env.AUDIT_LOG_FILE || '').trim();
const SERVER_START_CMD = process.env.SMOKE_SERVER_CMD || 'node';
const SERVER_START_ARGS = parseArgs(process.env.SMOKE_SERVER_ARGS, ['server/index.js']);
const BASE_URL_PORT = (() => {
  try {
    const parsed = new URL(BASE_URL);
    if (parsed.port) return String(parsed.port);
    return parsed.protocol === 'https:' ? '443' : '80';
  } catch {
    return '';
  }
})();

function parseBoolean(raw, fallback) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function parseArgs(raw, fallback) {
  const text = String(raw ?? '').trim();
  if (!text) return fallback;
  return text.split(/\s+/g).filter(Boolean);
}

function ensureMinSecret(rawValue, fallbackValue) {
  const value = String(rawValue || '').trim();
  if (value.length >= 32) return value;
  return fallbackValue;
}

function buildServerEnv() {
  if (!LOCAL_PROFILE) return process.env;
  const env = { ...process.env };
  env.NODE_ENV = String(env.SMOKE_SERVER_NODE_ENV || env.NODE_ENV || 'development').trim() || 'development';
  env.DATABASE_URL = '';
  env.REDIS_URL = '';
  env.ALLOW_INSECURE_STARTUP_FOR_TESTS = 'true';
  env.CORS_ORIGIN = String(env.CORS_ORIGIN || 'http://localhost:5173').trim();
  env.FRONTEND_ORIGIN = String(env.FRONTEND_ORIGIN || 'http://localhost:5173').trim();
  env.JWT_SECRET = ensureMinSecret(env.JWT_SECRET, 'smoke_local_jwt_secret_1234567890123456');
  env.RUN_STARTUP_TASKS = String(env.RUN_STARTUP_TASKS || 'false').trim() || 'false';
  env.FLIGHT_DB_FILE = String(env.FLIGHT_DB_FILE || LOCAL_DB_FILE).trim() || LOCAL_DB_FILE;
  env.AUDIT_LOG_FILE = String(env.AUDIT_LOG_FILE || LOCAL_AUDIT_LOG_FILE).trim() || LOCAL_AUDIT_LOG_FILE;
  env.AUDIT_LOG_HMAC_KEY = String(env.AUDIT_LOG_HMAC_KEY || 'go_live_smoke_hmac_key_1234567890').trim();
  if (BASE_URL_PORT) env.PORT = BASE_URL_PORT;
  return env;
}

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function waitFor(path, attempts = 30, delayMs = 400) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}${path}`);
      if (res.ok) return true;
    } catch {}
    await delay(delayMs);
  }
  return false;
}

function spawnServerProcess() {
  const modeLabel = LOCAL_PROFILE ? 'local_profile' : 'inherited_env';
  console.log(`go-live-smoke: starting server (${modeLabel}) -> ${SERVER_START_CMD} ${SERVER_START_ARGS.join(' ')}`);
  return spawn(SERVER_START_CMD, SERVER_START_ARGS, {
    stdio: 'inherit',
    env: buildServerEnv(),
    shell: false
  });
}

async function stopServerProcess(child) {
  if (!child) return;
  if (child.exitCode != null) return;

  child.kill();
  await Promise.race([once(child, 'exit'), delay(5000)]);

  if (child.exitCode == null && process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /pid ${child.pid} /t /f`], {
        stdio: 'ignore',
        env: process.env,
        shell: false
      });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
  }
}

async function cleanupLocalProfileDbFiles() {
  if (!SHOULD_CLEAN_LOCAL_DB && !SHOULD_CLEAN_LOCAL_AUDIT) return;
  const dir = dirname(LOCAL_DB_FILE);
  const file = basename(LOCAL_DB_FILE);
  const auditDir = dirname(LOCAL_AUDIT_LOG_FILE);
  const auditFile = basename(LOCAL_AUDIT_LOG_FILE);
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    entries = [];
  }
  const targets = [];
  if (SHOULD_CLEAN_LOCAL_DB) {
    targets.push(
      ...entries.filter((entry) => {
        if (entry === file) return true;
        if (entry === `${file}.bak`) return true;
        if (entry.startsWith(`${file}.tmp-`)) return true;
        if (entry.startsWith(`${file}.corrupt-`)) return true;
        return false;
      }).map((entry) => resolve(dir, entry))
    );
  }
  if (SHOULD_CLEAN_LOCAL_AUDIT) {
    let auditEntries = [];
    try {
      auditEntries = await readdir(auditDir);
    } catch {
      auditEntries = [];
    }
    targets.push(
      ...auditEntries
        .filter((entry) => entry === auditFile || entry === `${auditFile}.lock`)
        .map((entry) => resolve(auditDir, entry))
    );
  }
  await Promise.all(
    targets.map((entryPath) =>
      rm(entryPath, { force: true }).catch(() => {})
    )
  );
}

function semanticCheckOk(result) {
  if (result.name === 'api_health') {
    return Boolean(result?.body?.ok);
  }
  if (result.name === 'observability_health') {
    return Boolean(result?.body?.ok);
  }
  if (result.name === 'data_status') {
    return Boolean(result?.body?.ok);
  }
  if (result.name === 'security_health') {
    const checks = Array.isArray(result?.body?.checks) ? result.body.checks : [];
    const ignored = new Set(['runtime_config_blocking', 'startup_policy']);
    const failedCritical = checks.filter((item) => !item?.ok && !ignored.has(String(item?.id || '')));
    return failedCritical.length === 0;
  }
  return true;
}

async function ensureServerReady() {
  const alreadyUp = await waitFor('/health', 8, 300);
  if (alreadyUp) return { started: null, preExisting: true };
  if (!AUTO_START_SERVER) throw new Error(`Server not healthy at ${BASE_URL}`);

  const started = spawnServerProcess();
  const up = await waitFor('/health', 80, 500);
  if (!up) {
    const code = started.exitCode;
    await stopServerProcess(started);
    throw new Error(`Server not healthy at ${BASE_URL} after startup${code != null ? ` (exitCode=${code})` : ''}`);
  }
  return { started, preExisting: false };
}

async function run() {
  const { started, preExisting } = await ensureServerReady();

  try {
    const checks = [
      ['/health', 'core_health'],
      ['/health/db', 'db_health'],
      ['/health/engine', 'engine_health'],
      ['/api/health', 'api_health'],
      ['/api/health/security', 'security_health'],
      ['/api/health/observability', 'observability_health'],
      ['/api/system/data-status', 'data_status']
    ];

    const results = [];
    for (const [path, name] of checks) {
      const result = await getJson(path);
      const semanticOk = result.ok ? semanticCheckOk({ ...result, name }) : false;
      results.push({ name, path, ...result, semanticOk });
    }

    const failed = results.filter((r) => !r.ok || !r.semanticOk);
    if (failed.length > 0) {
      console.error('go-live-smoke: FAIL');
      for (const row of failed) {
        console.error(`- ${row.name} ${row.path}: status=${row.status}, semanticOk=${row.semanticOk}`);
      }
      process.exit(1);
    }

    console.log('go-live-smoke: PASS');
    console.log(`- server_mode: ${preExisting ? 'pre_existing' : 'auto_started'}`);
    for (const row of results) {
      console.log(`- ${row.name} ${row.path}: status=${row.status}, semanticOk=${row.semanticOk}`);
    }
  } finally {
    await stopServerProcess(started);
    await cleanupLocalProfileDbFiles();
  }
}

run().catch((error) => {
  console.error('go-live-smoke: ERROR', error?.message || error);
  process.exit(1);
});
