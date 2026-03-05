import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.SECURITY_TEST_PORT || '3100';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ORIGIN = process.env.SECURITY_TEST_ORIGIN || 'http://localhost:5173';

function mergeSetCookie(existing, setCookieHeaders = []) {
  const map = new Map();
  for (const chunk of existing.split(';')) {
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

async function waitForHealth() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {}
    await delay(300);
  }
  throw new Error('Server did not start in time.');
}

const child = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT,
    NODE_ENV: 'test',
    JWT_SECRET: process.env.JWT_SECRET || '12345678901234567890123456789012'
  },
  stdio: 'inherit'
});

try {
  await waitForHealth();
  let cookie = '';

  const email = `security-${Date.now()}@example.com`;
  const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Security Test', email, password: 'Aa!23456789' })
  });
  if (!registerRes.ok) throw new Error(`register failed: ${registerRes.status}`);
  cookie = mergeSetCookie(cookie, registerRes.headers.getSetCookie?.() || []);
  const registerPayload = await registerRes.json();
  const csrf = registerPayload?.session?.csrfToken;
  if (!csrf) throw new Error('missing csrf token from register session');

  const noCsrfRes = await fetch(`${BASE_URL}/api/notifications/read-all`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ORIGIN }
  });
  if (noCsrfRes.status !== 403) throw new Error(`expected 403 without csrf, got ${noCsrfRes.status}`);

  const withCsrfRes = await fetch(`${BASE_URL}/api/notifications/read-all`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ORIGIN, 'X-CSRF-Token': csrf }
  });
  if (withCsrfRes.status !== 204) throw new Error(`expected 204 with csrf, got ${withCsrfRes.status}`);

  const refreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ORIGIN, 'X-CSRF-Token': csrf }
  });
  if (!refreshRes.ok) throw new Error(`refresh failed: ${refreshRes.status}`);
  cookie = mergeSetCookie(cookie, refreshRes.headers.getSetCookie?.() || []);

  const securityRes = await fetch(`${BASE_URL}/api/health/security`);
  if (!securityRes.ok) throw new Error(`security health failed: ${securityRes.status}`);
  const security = await securityRes.json();
  if (!security?.ok) throw new Error('security health check not ok');

  console.log('security-smoke: PASS');
} finally {
  child.kill('SIGTERM');
}
