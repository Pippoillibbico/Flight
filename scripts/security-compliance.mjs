import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = Number(process.env.SECURITY_COMPLIANCE_PORT || 3102);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ALLOWED_ORIGIN = process.env.SECURITY_TEST_ORIGIN || 'http://localhost:5173';
const BLOCKED_ORIGIN = 'http://evil.example';

function mergeSetCookie(existing, setCookieHeaders = []) {
  const map = new Map();
  for (const chunk of String(existing || '').split(';')) {
    const [k, v] = chunk.trim().split('=');
    if (k && v) map.set(k, v);
  }
  for (const header of setCookieHeaders) {
    const [pair] = String(header).split(';');
    const [k, v] = pair.split('=');
    if (k && v) map.set(k.trim(), v.trim());
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function createCheck(id, ok, detail) {
  return { id, ok, detail };
}

async function waitForHealth() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {}
    await delay(300);
  }
  throw new Error('Server did not start in time for compliance checks.');
}

function assertSafeErrorBody(payloadText) {
  const lower = String(payloadText || '').toLowerCase();
  return !lower.includes('stack') && !lower.includes('syntaxerror') && !lower.includes('node:');
}

async function runEnvAuditChecks() {
  const checks = [];
  const envExampleRaw = await readFile('.env.example', 'utf8');
  const mustHave = [
    'PORT=',
    'NODE_ENV=',
    'JWT_SECRET=',
    'OPENAI_API_KEY=',
    'CLAUDE_API_KEY=',
    'DATABASE_URL=',
    'REDIS_URL=',
    'CORS_ORIGIN=',
    'RATE_LIMIT_WINDOW=',
    'RATE_LIMIT_MAX='
  ];
  const missing = mustHave.filter((entry) => !envExampleRaw.includes(entry));
  checks.push(createCheck('env_example_keys', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'all required keys present'));

  const weakJwt =
    /JWT_SECRET\s*=\s*(dev|changeme|secret|123456|password|test)/i.test(envExampleRaw) ||
    /JWT_SECRET\s*=\s*["']?\s*["']?\s*$/im.test(envExampleRaw);
  checks.push(createCheck('env_example_jwt_placeholder', !weakJwt, weakJwt ? 'weak/empty JWT_SECRET placeholder detected' : 'JWT placeholder not weak'));

  const repoFiles = ['server/index.js', 'src/api.js', 'docker-compose.yml'];
  let leaked = false;
  for (const file of repoFiles) {
    const raw = await readFile(file, 'utf8');
    if (/sk-[a-z0-9]{20,}/i.test(raw) || /AIza[0-9A-Za-z_\-]{20,}/.test(raw)) {
      leaked = true;
      break;
    }
  }
  checks.push(createCheck('secrets_hardcoded_scan', !leaked, leaked ? 'possible secret pattern detected in tracked file' : 'no obvious hardcoded provider secret patterns'));

  return checks;
}

const child = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'production',
    JWT_SECRET: process.env.JWT_SECRET || '12345678901234567890123456789012',
    CORS_ORIGIN: ALLOWED_ORIGIN,
    AUDIT_LOG_HMAC_KEY: process.env.AUDIT_LOG_HMAC_KEY || 'compliance_hmac_key_for_checks_only'
  },
  stdio: 'inherit'
});

const checks = [];

try {
  await waitForHealth();

  const healthRes = await fetch(`${BASE_URL}/api/health`);
  checks.push(createCheck('health_ok', healthRes.ok, `status=${healthRes.status}`));

  const helmetRes = await fetch(`${BASE_URL}/api/health`, {
    headers: { Origin: ALLOWED_ORIGIN }
  });
  const cspHeader = helmetRes.headers.get('content-security-policy');
  const xcto = helmetRes.headers.get('x-content-type-options');
  const xfo = helmetRes.headers.get('x-frame-options');
  checks.push(createCheck('helmet_headers_xcto', xcto === 'nosniff', `x-content-type-options=${xcto || 'missing'}`));
  checks.push(createCheck('helmet_headers_xfo', typeof xfo === 'string' && xfo.length > 0, `x-frame-options=${xfo || 'missing'}`));
  checks.push(createCheck('helmet_csp_present_prod', Boolean(cspHeader), cspHeader ? 'present' : 'missing'));

  const preflightAllowed = await fetch(`${BASE_URL}/api/health`, {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'GET'
    }
  });
  checks.push(createCheck('cors_preflight_allowed_status', preflightAllowed.status === 204, `status=${preflightAllowed.status}`));
  checks.push(
    createCheck(
      'cors_preflight_allowed_origin',
      preflightAllowed.headers.get('access-control-allow-origin') === ALLOWED_ORIGIN,
      `acao=${preflightAllowed.headers.get('access-control-allow-origin') || 'missing'}`
    )
  );
  checks.push(
    createCheck(
      'cors_credentials_not_wildcard',
      preflightAllowed.headers.get('access-control-allow-credentials') === 'true' &&
        preflightAllowed.headers.get('access-control-allow-origin') !== '*',
      `credentials=${preflightAllowed.headers.get('access-control-allow-credentials') || 'missing'}, acao=${preflightAllowed.headers.get('access-control-allow-origin') || 'missing'}`
    )
  );

  const preflightBlocked = await fetch(`${BASE_URL}/api/health`, {
    method: 'OPTIONS',
    headers: {
      Origin: BLOCKED_ORIGIN,
      'Access-Control-Request-Method': 'GET'
    }
  });
  checks.push(createCheck('cors_preflight_blocked_origin', preflightBlocked.status === 403, `status=${preflightBlocked.status}`));

  let cookie = '';
  const email = `compliance-${Date.now()}@example.com`;
  const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Compliance User', email, password: 'Aa!23456789' })
  });
  const registerBody = await registerRes.json();
  const csrf = registerBody?.session?.csrfToken || '';
  cookie = mergeSetCookie(cookie, registerRes.headers.getSetCookie?.() || []);
  checks.push(createCheck('csrf_register_session', registerRes.status === 201 && Boolean(csrf), `status=${registerRes.status}, csrf=${csrf ? 'present' : 'missing'}`));

  const csrfMissing = await fetch(`${BASE_URL}/api/notifications/read-all`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN }
  });
  checks.push(createCheck('csrf_enforced_missing_token', csrfMissing.status === 403, `status=${csrfMissing.status}`));

  const csrfWrongOrigin = await fetch(`${BASE_URL}/api/notifications/read-all`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: BLOCKED_ORIGIN, 'X-CSRF-Token': csrf }
  });
  checks.push(createCheck('csrf_enforced_wrong_origin', csrfWrongOrigin.status === 403, `status=${csrfWrongOrigin.status}`));

  const csrfOk = await fetch(`${BASE_URL}/api/notifications/read-all`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN, 'X-CSRF-Token': csrf }
  });
  checks.push(createCheck('csrf_enforced_valid_token', csrfOk.status === 204, `status=${csrfOk.status}`));

  const refreshMissing = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  checks.push(createCheck('refresh_requires_origin_csrf', refreshMissing.status === 403, `status=${refreshMissing.status}`));

  const refreshOk = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN, 'X-CSRF-Token': csrf }
  });
  checks.push(createCheck('refresh_accepts_origin_csrf', refreshOk.status === 200, `status=${refreshOk.status}`));

  const sqliAttempt = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: "' OR 1=1 --@example.com", password: 'anything123' })
  });
  checks.push(createCheck('pentest_sqli_login_no_500', sqliAttempt.status !== 500, `status=${sqliAttempt.status}`));

  const malformedJson = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email":"bad@example.com", "password": "Aa!23456789"'
  });
  const malformedBody = await malformedJson.text();
  checks.push(createCheck('pentest_malformed_json_no_500', malformedJson.status >= 400 && malformedJson.status < 500, `status=${malformedJson.status}`));
  checks.push(createCheck('pentest_no_stack_leak', assertSafeErrorBody(malformedBody), 'response body sanitized'));

  const securityHealth = await fetch(`${BASE_URL}/api/health/security`);
  const securityPayload = await securityHealth.json();
  checks.push(createCheck('security_health_endpoint_ok', securityHealth.ok && securityPayload?.ok === true, `status=${securityHealth.status}, ok=${Boolean(securityPayload?.ok)}`));

  const envChecks = await runEnvAuditChecks();
  checks.push(...envChecks);

  const failed = checks.filter((item) => !item.ok);
  if (failed.length > 0) {
    console.error('security-compliance: FAIL');
    for (const item of failed) console.error(`- ${item.id}: ${item.detail}`);
    process.exitCode = 1;
  } else {
    console.log('security-compliance: PASS');
  }

  for (const item of checks) {
    console.log(`[${item.ok ? 'PASS' : 'FAIL'}] ${item.id} :: ${item.detail}`);
  }
} finally {
  child.kill('SIGTERM');
}
