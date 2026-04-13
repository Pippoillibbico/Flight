import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const ALLOWED_ORIGIN = 'https://app.flightsuite.test';

function uniqueEmail(prefix = 'register') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}@example.com`;
}

async function waitForHealth(baseUrl, { child, getLogs, retries = 80, intervalMs = 250 } = {}) {
  for (let i = 0; i < retries; i += 1) {
    if (child && child.exitCode !== null) {
      throw new Error(`Server exited before healthcheck. exitCode=${child.exitCode}\n${getLogs?.() || ''}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: ALLOWED_ORIGIN, 'x-forwarded-proto': 'https' }
      });
      if (response.ok) return;
    } catch {}
    await delay(intervalMs);
  }
  throw new Error(`Server did not become healthy in time.\n${getLogs?.() || ''}`);
}

function createLegacySqliteSchema(dbFile) {
  const db = new DatabaseSync(dbFile);
  db.exec(`
    DROP TABLE IF EXISTS user_leads;
    DROP TABLE IF EXISTS search_events;
    DROP TABLE IF EXISTS email_delivery_log;
    CREATE TABLE user_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'register',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE search_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      region TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE email_delivery_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_message_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.close();
}

async function startServer({ envOverrides = {}, legacySqliteSchema = false } = {}) {
  const sandboxDir = await mkdtemp(join(tmpdir(), 'flight-register-security-'));
  const jsonDbFile = join(sandboxDir, 'db.json');
  const sqliteDbFile = join(sandboxDir, 'app.db');
  const auditLogFile = join(sandboxDir, 'audit.ndjson');

  if (legacySqliteSchema) createLegacySqliteSchema(sqliteDbFile);

  const port = 3300 + Math.floor(Math.random() * 2000);
  const baseUrl = `http://127.0.0.1:${port}`;

  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      JWT_SECRET: process.env.JWT_SECRET || '12345678901234567890123456789012',
      OUTBOUND_CLICK_SECRET: process.env.OUTBOUND_CLICK_SECRET || 'register_endpoint_outbound_hmac_key_1234567890',
      ALLOW_MOCK_BILLING_UPGRADES: 'false',
      INTERNAL_INGEST_TOKEN: process.env.INTERNAL_INGEST_TOKEN || 'internal_ingest_token_for_register_tests_1234',
      FRONTEND_ORIGIN: ALLOWED_ORIGIN,
      CORS_ORIGIN: ALLOWED_ORIGIN,
      CORS_ALLOWLIST: ALLOWED_ORIGIN,
      TRUST_PROXY: '1',
      RUN_STARTUP_TASKS: 'false',
      BILLING_PROVIDER: 'braintree',
      BT_MERCHANT_ID: 'merchant_test',
      BT_PUBLIC_KEY: 'public_test',
      BT_PRIVATE_KEY: 'private_key_test_12345',
      BT_ENVIRONMENT: 'sandbox',
      FLIGHT_DB_FILE: jsonDbFile,
      SQLITE_DB_FILE: sqliteDbFile,
      AUDIT_LOG_FILE: auditLogFile,
      ALLOW_INSECURE_STARTUP_FOR_TESTS: 'true',
      ALLOW_INSECURE_STARTUP_IN_PRODUCTION: 'true',
      DATABASE_URL: '',
      REDIS_URL: '',
      ...envOverrides
    },
    stdio: 'pipe',
    windowsHide: true
  });

  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const getLogs = () => {
    const out = stdout.trim();
    const err = stderr.trim();
    if (!out && !err) return 'No logs captured';
    return `[stdout]\n${out}\n[stderr]\n${err}`;
  };

  await waitForHealth(baseUrl, { child, getLogs });

  return {
    child,
    baseUrl,
    sandboxDir,
    getLogs
  };
}

async function waitForExit(child, timeoutMs = 4000) {
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once('exit', finish);
    setTimeout(finish, timeoutMs).unref?.();
  });
}

async function stopServer(state) {
  if (!state) return;
  state.child.kill('SIGTERM');
  await waitForExit(state.child);
  await rm(state.sandboxDir, { recursive: true, force: true });
}

async function registerRequest(serverState, payload) {
  return fetch(`${serverState.baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ALLOWED_ORIGIN,
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify(payload)
  });
}

test(
  'register succeeds with valid payload and returns session envelope',
  { timeout: 90000 },
  async () => {
    const serverState = await startServer();
    try {
      const response = await registerRequest(serverState, {
        name: 'Security User',
        email: uniqueEmail('success'),
        password: 'Aa!23456789'
      });
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(typeof body?.session?.csrfToken, 'string');
      assert.equal(body.session.csrfToken.length > 0, true);
    } finally {
      await stopServer(serverState);
    }
  }
);

test(
  'register rejects invalid payload with invalid_payload and no 500',
  { timeout: 90000 },
  async () => {
    const serverState = await startServer();
    try {
      const response = await registerRequest(serverState, {
        name: 'x',
        email: 'bad-email',
        password: 'short',
        role: 'admin'
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.error, 'invalid_payload');
      assert.notEqual(response.status, 500);
    } finally {
      await stopServer(serverState);
    }
  }
);

test(
  'register returns email_already_exists for duplicate email',
  { timeout: 90000 },
  async () => {
    const serverState = await startServer();
    try {
      const email = uniqueEmail('duplicate');
      const first = await registerRequest(serverState, {
        name: 'Duplicate User',
        email,
        password: 'Aa!23456789'
      });
      assert.equal(first.status, 201);

      const second = await registerRequest(serverState, {
        name: 'Duplicate User',
        email,
        password: 'Aa!23456789'
      });
      assert.equal(second.status, 409);
      const body = await second.json();
      assert.equal(body.error, 'email_already_exists');
    } finally {
      await stopServer(serverState);
    }
  }
);

test(
  'register returns registration_disabled when auth registration is disabled by config',
  { timeout: 90000 },
  async () => {
    const serverState = await startServer({
      envOverrides: { AUTH_REGISTRATION_ENABLED: 'false' }
    });
    try {
      const response = await registerRequest(serverState, {
        name: 'Disabled User',
        email: uniqueEmail('disabled'),
        password: 'Aa!23456789'
      });
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.error, 'registration_disabled');
    } finally {
      await stopServer(serverState);
    }
  }
);

test(
  'register on legacy sqlite schema does not return 500',
  { timeout: 90000 },
  async () => {
    const serverState = await startServer({ legacySqliteSchema: true });
    try {
      const response = await registerRequest(serverState, {
        name: 'Legacy Schema User',
        email: uniqueEmail('legacy'),
        password: 'Aa!23456789'
      });
      assert.equal(response.status, 201, `unexpected status=${response.status}; logs:\n${serverState.getLogs()}`);
      assert.notEqual(response.status, 500);
    } finally {
      await stopServer(serverState);
    }
  }
);
