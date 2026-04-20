import { resolve4, resolve6, resolveCname } from 'node:dns/promises';
import tls from 'node:tls';

function fail(message, detail = null) {
  const payload = detail ? `${message} :: ${detail}` : message;
  throw new Error(payload);
}

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) fail('PROD_BASE_URL is required');
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('PROD_BASE_URL is not a valid URL', value);
  }
  if (url.protocol !== 'https:') fail('PROD_BASE_URL must use https', url.toString());
  if (!url.hostname) fail('PROD_BASE_URL must include a hostname');
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    fail('PROD_BASE_URL cannot be localhost for production audit');
  }
  return url;
}

async function resolveDns(hostname) {
  const out = { a: [], aaaa: [], cname: [] };
  try {
    out.a = await resolve4(hostname);
  } catch {}
  try {
    out.aaaa = await resolve6(hostname);
  } catch {}
  try {
    out.cname = await resolveCname(hostname);
  } catch {}
  if (out.a.length === 0 && out.aaaa.length === 0 && out.cname.length === 0) {
    fail('DNS resolution failed for hostname', hostname);
  }
  return out;
}

function assertSecurityHeaders(headers) {
  const required = ['x-content-type-options', 'x-frame-options'];
  const missing = required.filter((key) => !headers.get(key));
  if (missing.length > 0) {
    fail('Missing required security response headers', missing.join(', '));
  }
}

async function getTlsCertificateInfo(hostname, port = 443) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        rejectUnauthorized: true
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert);
      }
    );
    socket.on('error', reject);
  });
}

function certDaysRemaining(cert) {
  const validTo = new Date(String(cert?.valid_to || ''));
  if (Number.isNaN(validTo.getTime())) return -1;
  const diffMs = validTo.getTime() - Date.now();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

async function fetchJson(url, { method = 'GET', headers = {}, body = null, expectStatuses = [200] } = {}) {
  const response = await fetch(url, { method, headers, body });
  if (!expectStatuses.includes(response.status)) {
    const text = await response.text().catch(() => '');
    fail(`Unexpected status for ${method} ${url}`, `${response.status} ${text.slice(0, 200)}`);
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : null;
  return { response, payload };
}

function logCheck(name, ok, detail = '') {
  const tag = ok ? 'OK' : 'FAIL';
  const suffix = detail ? ` :: ${detail}` : '';
  console.log(`[${tag}] ${name}${suffix}`);
}

async function run() {
  const baseUrl = normalizeBaseUrl(process.env.PROD_BASE_URL);
  const hostname = baseUrl.hostname;
  const origin = baseUrl.origin;

  const dns = await resolveDns(hostname);
  logCheck('dns', true, `A=${dns.a.length} AAAA=${dns.aaaa.length} CNAME=${dns.cname.length}`);

  const cert = await getTlsCertificateInfo(hostname);
  const remainingDays = certDaysRemaining(cert);
  if (remainingDays < 14) {
    fail('TLS certificate expires too soon (<14 days)', `remainingDays=${remainingDays}`);
  }
  logCheck('tls-certificate', true, `remainingDays=${remainingDays}`);

  const httpProbe = await fetch(`${baseUrl.protocol === 'https:' ? `http://${hostname}` : origin}/healthz`, {
    redirect: 'manual'
  }).catch(() => null);
  if (httpProbe) {
    const status = Number(httpProbe.status || 0);
    if (![301, 302, 307, 308].includes(status)) {
      fail('HTTP to HTTPS redirect not enforced for plain HTTP', `status=${status}`);
    }
    logCheck('http-redirect', true, `status=${status}`);
  }

  const health = await fetchJson(`${origin}/health`);
  if (!health.payload?.status || String(health.payload.status).toLowerCase() !== 'ok') {
    fail('/health payload is not healthy');
  }
  assertSecurityHeaders(health.response.headers);
  const hsts = String(health.response.headers.get('strict-transport-security') || '').trim();
  if (!hsts) fail('Missing strict-transport-security header');
  logCheck('health', true, '/health status ok + security headers present');

  const healthz = await fetchJson(`${origin}/healthz`);
  if (!healthz.payload?.ok) fail('/healthz payload is not healthy');
  logCheck('healthz', true);

  const readyz = await fetchJson(`${origin}/readyz`);
  if (!readyz.payload?.ok) fail('/readyz payload is not ready');
  logCheck('readyz', true);

  const capabilities = await fetchJson(`${origin}/api/system/capabilities`);
  const caps = capabilities.payload?.capabilities || {};
  if (caps?.billing_mock_mode === true) {
    fail('billing_mock_mode=true is not allowed in production');
  }
  if (caps?.data_source && !['live', 'internal', 'synthetic'].includes(String(caps.data_source))) {
    fail('Unexpected capabilities.data_source value', String(caps.data_source));
  }
  logCheck('capabilities', true, `data_source=${String(caps?.data_source || 'n/a')}`);

  const billingConfig = await fetchJson(`${origin}/api/billing/public-config`);
  if (billingConfig.payload?.billingProvider && billingConfig.payload.billingProvider !== 'stripe') {
    fail('Unexpected billing provider in public config', String(billingConfig.payload.billingProvider));
  }
  logCheck('billing-public-config', true);

  await fetchJson(`${origin}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ping: true }),
    expectStatuses: [400, 401]
  });
  logCheck('billing-webhook-route', true, 'reachable (expects signed requests)');

  console.log('\n[prod-external-audit] completed successfully');
}

run().catch((error) => {
  console.error('\n[prod-external-audit] failed');
  console.error(error?.message || error);
  process.exit(1);
});
