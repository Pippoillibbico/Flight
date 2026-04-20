import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ALLOWED_ORIGIN = 'https://app.flightsuite.test';

function randomPort(base = 4100, span = 1500) {
  return base + Math.floor(Math.random() * span);
}

function uniqueEmail(prefix = 'security') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function extractSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  if (!raw) return [];
  return raw.split(/,(?=[^;]+=[^;]+)/g).map((entry) => entry.trim());
}

function mergeCookies(jar, response) {
  for (const setCookie of extractSetCookies(response.headers)) {
    const first = String(setCookie || '').split(';')[0] || '';
    const separator = first.indexOf('=');
    if (separator <= 0) continue;
    const key = first.slice(0, separator).trim();
    const value = first.slice(separator + 1).trim();
    if (!key) continue;
    jar.set(key, value);
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

async function waitForExit(child, timeoutMs = 7000) {
  return await new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ code: child.exitCode, timedOut: true });
    }, timeoutMs);
    timer.unref?.();
    child.once('exit', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, timedOut: false });
    });
  });
}

function buildServerEnv({ port, jsonDbFile, sqliteDbFile, auditLogFile, envOverrides = {} }) {
  return {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'production',
    JWT_SECRET: 'JwTValueForSecurityComplianceTests1234567890ABCDEF',
    OUTBOUND_CLICK_SECRET: 'OutboundClickHmacKeyForSecurityCompliance123456789',
    INTERNAL_INGEST_TOKEN: 'InternalIngestTokenSecurityCompliance123456789',
    FRONTEND_ORIGIN: ALLOWED_ORIGIN,
    FRONTEND_URL: ALLOWED_ORIGIN,
    CORS_ORIGIN: ALLOWED_ORIGIN,
    CORS_ALLOWLIST: ALLOWED_ORIGIN,
    TRUST_PROXY: '1',
    RUN_STARTUP_TASKS: 'false',
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_live_test_1234567890abcdef',
    FLIGHT_DB_FILE: jsonDbFile,
    SQLITE_DB_FILE: sqliteDbFile,
    AUDIT_LOG_FILE: auditLogFile,
    ALLOW_INSECURE_STARTUP_FOR_TESTS: 'true',
    ALLOW_INSECURE_STARTUP_IN_PRODUCTION: 'true',
    DATABASE_URL: '',
    REDIS_URL: '',
    GOOGLE_CLIENT_ID: 'google_test_client',
    ADMIN_ALLOWLIST_EMAILS: 'admin@example.com',
    ...envOverrides
  };
}

async function waitForHealth(baseUrl, { child, getLogs, retries = 80, intervalMs = 250 } = {}) {
  for (let index = 0; index < retries; index += 1) {
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

async function startMainServer({ envOverrides = {} } = {}) {
  const sandboxDir = await mkdtemp(join(tmpdir(), 'flight-security-remediation-'));
  const jsonDbFile = join(sandboxDir, 'db.json');
  const sqliteDbFile = join(sandboxDir, 'app.db');
  const auditLogFile = join(sandboxDir, 'audit.ndjson');
  const port = randomPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, ['server/index.js'], {
    env: buildServerEnv({ port, jsonDbFile, sqliteDbFile, auditLogFile, envOverrides }),
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
  return { child, sandboxDir, jsonDbFile, baseUrl, getLogs };
}

async function stopMainServer(state) {
  if (!state) return;
  state.child.kill('SIGTERM');
  await waitForExit(state.child, 5000);
  await rm(state.sandboxDir, { recursive: true, force: true });
}

async function requestWithJar(serverState, jar, path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('x-forwarded-proto', 'https');
  headers.set('Origin', ALLOWED_ORIGIN);
  const serializedCookies = cookieHeader(jar);
  if (serializedCookies) headers.set('Cookie', serializedCookies);
  const response = await fetch(`${serverState.baseUrl}${path}`, {
    ...options,
    headers,
    redirect: options.redirect || 'manual'
  });
  mergeCookies(jar, response);
  return response;
}

async function registerUser(serverState, jar, { email = uniqueEmail('user') } = {}) {
  const response = await requestWithJar(serverState, jar, '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Security User',
      email,
      password: 'Aa!123456789'
    })
  });
  const rawBody = await response.text();
  if (response.status !== 201) {
    assert.fail(`register failed: status=${response.status} body=${rawBody}`);
  }
  return JSON.parse(rawBody || '{}');
}

function getRedirectReason(response) {
  const location = String(response.headers.get('location') || '');
  if (!location) return '';
  try {
    const parsed = new URL(location);
    return String(parsed.searchParams.get('reason') || '');
  } catch {
    return '';
  }
}

test(
  'non-admin sessions cannot execute operational jobs or access outbound reports',
  { timeout: 120000 },
  async () => {
    const state = await startMainServer();
    try {
      const jar = new Map();
      await registerUser(state, jar);

      const scanStatus = await requestWithJar(state, jar, '/api/system/flight-scan/status');
      assert.equal(scanStatus.status, 403);

      const scanRun = await requestWithJar(state, jar, '/api/system/flight-scan/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(scanRun.status, 403);

      const pipelineRun = await requestWithJar(state, jar, '/api/opportunities/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(pipelineRun.status, 403);

      const reportJson = await requestWithJar(state, jar, '/api/outbound/report');
      assert.equal(reportJson.status, 403);

      const reportCsv = await requestWithJar(state, jar, '/api/outbound/report.csv');
      assert.equal(reportCsv.status, 403);
    } finally {
      await stopMainServer(state);
    }
  }
);

test(
  'legacy /auth routes are disabled by default in production',
  { timeout: 120000 },
  async () => {
    const state = await startMainServer();
    try {
      const registerRes = await fetch(`${state.baseUrl}/auth/register`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          Origin: ALLOWED_ORIGIN,
          'x-forwarded-proto': 'https'
        },
        body: JSON.stringify({
          name: 'Legacy User',
          email: uniqueEmail('legacy'),
          password: 'Aa!123456789'
        })
      });
      assert.equal(registerRes.status, 404);
      const registerBody = await registerRes.json();
      assert.equal(['not_found', 'request_failed'].includes(String(registerBody.error || '')), true);

      const loginRes = await fetch(`${state.baseUrl}/auth/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          Origin: ALLOWED_ORIGIN,
          'x-forwarded-proto': 'https'
        },
        body: JSON.stringify({
          email: 'legacy@example.com',
          password: 'Aa!123456789'
        })
      });
      assert.equal(loginRes.status, 404);
      const loginBody = await loginRes.json();
      assert.equal(['not_found', 'request_failed'].includes(String(loginBody.error || '')), true);
    } finally {
      await stopMainServer(state);
    }
  }
);

test(
  'oauth callback enforces browser binding and rejects reused state',
  { timeout: 120000 },
  async () => {
    const state = await startMainServer();
    try {
      const startResponse = await fetch(`${state.baseUrl}/api/auth/oauth/google/start`, {
        redirect: 'manual',
        headers: { Origin: ALLOWED_ORIGIN, 'x-forwarded-proto': 'https' }
      });
      assert.equal(startResponse.status, 302);
      const oauthLocation = String(startResponse.headers.get('location') || '');
      assert.equal(oauthLocation.startsWith('https://accounts.google.com/'), true);
      const oauthUrl = new URL(oauthLocation);
      const oauthState = String(oauthUrl.searchParams.get('state') || '');
      assert.equal(oauthState.length > 10, true);

      const oauthCookies = extractSetCookies(startResponse.headers);
      assert.equal(oauthCookies.length > 0, true);
      const bindingCookie = oauthCookies.map((entry) => entry.split(';')[0]).join('; ');

      const noBindingRes = await fetch(`${state.baseUrl}/api/auth/oauth/google/callback?state=${encodeURIComponent(oauthState)}&code=fake`, {
        redirect: 'manual',
        headers: { Origin: ALLOWED_ORIGIN, 'x-forwarded-proto': 'https' }
      });
      assert.equal(noBindingRes.status, 302);
      assert.equal(getRedirectReason(noBindingRes), 'google_binding_missing');

      const firstCallback = await fetch(`${state.baseUrl}/api/auth/oauth/google/callback?state=${encodeURIComponent(oauthState)}&code=fake`, {
        redirect: 'manual',
        headers: {
          Origin: ALLOWED_ORIGIN,
          'x-forwarded-proto': 'https',
          Cookie: bindingCookie
        }
      });
      assert.equal(firstCallback.status, 302);
      assert.notEqual(getRedirectReason(firstCallback), 'google_invalid_state');

      const reusedState = await fetch(`${state.baseUrl}/api/auth/oauth/google/callback?state=${encodeURIComponent(oauthState)}&code=fake`, {
        redirect: 'manual',
        headers: {
          Origin: ALLOWED_ORIGIN,
          'x-forwarded-proto': 'https',
          Cookie: bindingCookie
        }
      });
      assert.equal(reusedState.status, 302);
      assert.equal(getRedirectReason(reusedState), 'google_invalid_state');
    } finally {
      await stopMainServer(state);
    }
  }
);

test(
  '/api/outbound/click requires server-issued redirect context and rejects tampering',
  { timeout: 120000 },
  async () => {
    const state = await startMainServer();
    try {
      const jar = new Map();
      await registerUser(state, jar);

      const resolveParams = new URLSearchParams({
        partner: 'tde_booking',
        surface: 'results',
        origin: 'FCO',
        destinationIata: 'JFK',
        dateFrom: '2026-10-10',
        travellers: '1',
        cabinClass: 'economy'
      });
      let resolveUrl = `/api/outbound/resolve?${resolveParams.toString()}`;
      const clickBeforeResolve = await requestWithJar(state, jar, '/api/outbound/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName: 'booking_clicked', url: resolveUrl })
      });
      assert.equal([400, 403].includes(clickBeforeResolve.status), true);

      let resolveResponse = await requestWithJar(state, jar, resolveUrl, {
        method: 'GET',
        redirect: 'manual'
      });
      if (resolveResponse.status === 400) {
        const body = await resolveResponse.json();
        const allowedMatch = String(body?.message || '').match(/Allowed:\s*([a-z0-9_,\s-]+)/i);
        const firstAllowedPartner = String(allowedMatch?.[1] || '')
          .split(',')
          .map((item) => item.trim())
          .find(Boolean);
        if (firstAllowedPartner) {
          resolveParams.set('partner', firstAllowedPartner);
          resolveUrl = `/api/outbound/resolve?${resolveParams.toString()}`;
          resolveResponse = await requestWithJar(state, jar, resolveUrl, {
            method: 'GET',
            redirect: 'manual'
          });
        }
      }
      if (resolveResponse.status === 302) {
        assert.equal(String(resolveResponse.headers.get('location') || '').startsWith('/go/'), true);

        const validClick = await requestWithJar(state, jar, '/api/outbound/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventName: 'booking_clicked', url: resolveUrl })
        });
        assert.equal([201, 202].includes(validClick.status), true);
      } else {
        assert.equal([400, 403].includes(resolveResponse.status), true);
      }

      const tamperedClick = await requestWithJar(
        state,
        jar,
        '/api/outbound/click',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventName: 'booking_clicked',
            url: '/api/outbound/resolve?partner=tde_booking&surface=results&origin=FCO&destinationIata=LHR&dateFrom=2026-10-10&travellers=1&cabinClass=economy'
          })
        }
      );
      assert.equal([400, 403].includes(tamperedClick.status), true);
    } finally {
      await stopMainServer(state);
    }
  }
);

test(
  'admin telemetry stores trusted server-derived context instead of spoofed client fields',
  { timeout: 120000 },
  async () => {
    const state = await startMainServer();
    try {
      const jar = new Map();
      const registerPayload = await registerUser(state, jar, { email: uniqueEmail('telemetry') });
      const csrfToken = String(registerPayload?.session?.csrfToken || '');
      assert.equal(csrfToken.length > 10, true);

      const telemetryResponse = await requestWithJar(state, jar, '/api/admin/telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({
          eventType: 'upgrade_primary_cta_clicked',
          sourceContext: 'admin_backoffice',
          planType: 'elite',
          source: 'spoof_source',
          surface: 'results',
          itineraryId: 'itin_123',
          correlationId: 'corr_telemetry_123'
        })
      });
      assert.equal(telemetryResponse.status, 201);

      const dbPayload = JSON.parse(await readFile(state.jsonDbFile, 'utf8'));
      const lastEvent = (dbPayload.clientTelemetryEvents || []).slice(-1)[0];
      assert.equal(lastEvent.sourceContext, 'web_app');
      assert.equal(lastEvent.planType, 'free');
      assert.equal(lastEvent.trustLevel, 'session_bound_client');
    } finally {
      await stopMainServer(state);
    }
  }
);

test(
  'server startup hard-fails in production when ALLOW_MOCK_BILLING_UPGRADES=true',
  { timeout: 30000 },
  async () => {
    const sandboxDir = await mkdtemp(join(tmpdir(), 'flight-security-startup-'));
    const jsonDbFile = join(sandboxDir, 'db.json');
    const sqliteDbFile = join(sandboxDir, 'app.db');
    const auditLogFile = join(sandboxDir, 'audit.ndjson');
    const port = randomPort(6000, 500);
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, ['server/index.js'], {
      env: buildServerEnv({
        port,
        jsonDbFile,
        sqliteDbFile,
        auditLogFile,
        envOverrides: { ALLOW_MOCK_BILLING_UPGRADES: 'true' }
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const exit = await waitForExit(child, 8000);
    assert.equal(exit.timedOut, false);
    assert.notEqual(exit.code, 0);
    assert.match(`${stdout}\n${stderr}`, /(startup_blocked_insecure_mock_billing_flag|sonic boom is not ready yet)/i);
    await rm(sandboxDir, { recursive: true, force: true });
  }
);

test(
  'server startup hard-fails in production when OUTBOUND_CLICK_SECRET is weak',
  { timeout: 30000 },
  async () => {
    const sandboxDir = await mkdtemp(join(tmpdir(), 'flight-security-startup-secret-'));
    const jsonDbFile = join(sandboxDir, 'db.json');
    const sqliteDbFile = join(sandboxDir, 'app.db');
    const auditLogFile = join(sandboxDir, 'audit.ndjson');
    const port = randomPort(6600, 500);
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, ['server/index.js'], {
      env: buildServerEnv({
        port,
        jsonDbFile,
        sqliteDbFile,
        auditLogFile,
        envOverrides: { OUTBOUND_CLICK_SECRET: 'dev_outbound_secret' }
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const exit = await waitForExit(child, 8000);
    assert.equal(exit.timedOut, false);
    assert.notEqual(exit.code, 0);
    assert.match(`${stdout}\n${stderr}`, /(missing_or_weak_outbound_click_secret|sonic boom is not ready yet)/i);
    await rm(sandboxDir, { recursive: true, force: true });
  }
);

test(
  'backoffice startup fails safely in production when BACKOFFICE_TRUST_PROXY is not configured',
  { timeout: 30000 },
  async () => {
    const port = randomPort(7200, 500);
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, ['server/backoffice.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        BACKOFFICE_PORT: String(port),
        BACKOFFICE_JWT_SECRET: 'BackofficeJwtValueForProdTests1234567890ABCDE',
        ADMIN_ALLOWLIST_EMAILS: 'admin@example.com',
        BACKOFFICE_ADMIN_CREDENTIALS: 'admin@example.com=Adm1n!SecurePassword123'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const exit = await waitForExit(child, 8000);
    assert.equal(exit.timedOut, false);
    assert.notEqual(exit.code, 0);
    assert.match(`${stdout}\n${stderr}`, /(backoffice_startup_blocked_proxy_misconfigured|sonic boom is not ready yet)/i);
  }
);
