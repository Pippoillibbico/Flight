import { resolve4, resolve6, resolveCname } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import tls from 'node:tls';

function fail(message, detail = null) {
  const payload = detail ? `${message} :: ${detail}` : message;
  throw new Error(payload);
}

async function writePassEvidence({ origin, hostname, dns, certRemainingDays, capabilities }) {
  const logPath = resolve(process.cwd(), 'docs/audit/external-audit-pass.log');
  const lines = [
    `prod_external_audit=PASS`,
    `generated_at=${new Date().toISOString()}`,
    `origin=${origin}`,
    `hostname=${hostname}`,
    `dns_a=${dns.a.length}`,
    `dns_aaaa=${dns.aaaa.length}`,
    `dns_cname=${dns.cname.length}`,
    `tls_remaining_days=${certRemainingDays}`,
    `data_source=${String(capabilities?.data_source || 'n/a')}`,
    `provider_readiness=${String(capabilities?.provider_readiness || 'n/a')}`,
    `alert_delivery=${String(capabilities?.alert_delivery || 'n/a')}`,
    ''
  ];
  await mkdir(resolve(process.cwd(), 'docs/audit'), { recursive: true });
  await writeFile(logPath, lines.join('\n'), 'utf8');
  console.log(`[OK] evidence-written :: ${logPath}`);
}

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) fail('PROD_BASE_URL is required. Run: PROD_BASE_URL=https://<domain> npm run test:prod:external');
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
    fail(`Unexpected status for ${method} ${url}`, `status=${response.status}; body=${text.slice(0, 300)}`);
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : null;
  return { response, payload };
}

async function fetchText(url, { method = 'GET', headers = {}, body = null, expectStatuses = [200] } = {}) {
  const response = await fetch(url, { method, headers, body });
  const text = await response.text().catch(() => '');
  if (!expectStatuses.includes(response.status)) {
    fail(`Unexpected status for ${method} ${url}`, `status=${response.status}; body=${text.slice(0, 300)}`);
  }
  return { response, text };
}

function assertContains(value, pattern, context) {
  if (!pattern.test(String(value || ''))) {
    fail(`Expected content missing for ${context}`, String(pattern));
  }
}

function assertNoMisleadingCopy(value, context) {
  const text = String(value || '');
  const forbidden = [
    /live fares/i,
    /real-time radar/i,
    /AI-powered/i,
    /instant alerts/i,
    /deep scan/i,
    /live radar/i
  ];
  const hit = forbidden.find((pattern) => pattern.test(text));
  if (hit) {
    fail(`Misleading soft-launch copy found in ${context}`, String(hit));
  }
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
  const launch = capabilities.payload?.launch || {};
  if (caps?.billing_mock_mode === true) {
    fail('billing_mock_mode=true is not allowed in production');
  }
  if (caps?.data_source && !['live', 'internal', 'cached_public_scan', 'synthetic'].includes(String(caps.data_source))) {
    fail('Unexpected capabilities.data_source value', String(caps.data_source));
  }
  if (launch?.launchMode === 'soft') {
    if (String(caps?.provider_readiness || '') === 'PROVIDER_NOT_READY' && String(caps?.data_source || '') === 'live') {
      fail('Soft launch reports live data source while provider readiness is not ready');
    }
    if (String(caps?.alert_delivery || '') === 'ALERT_DELIVERY_NOT_READY' && caps?.instant_alerts === true) {
      fail('Soft launch reports instant alerts while alert delivery is not ready');
    }
  }
  logCheck(
    'capabilities',
    true,
    `launch=${String(launch?.launchMode || 'n/a')} data_source=${String(caps?.data_source || 'n/a')} provider=${String(caps?.provider_readiness || 'n/a')} alerts=${String(caps?.alert_delivery || 'n/a')}`
  );

  const home = await fetchText(`${origin}/`);
  assertSecurityHeaders(home.response.headers);
  assertContains(home.text, /<html/i, '/');
  assertContains(home.text, /(privacy-policy|cookie-policy|terms|assets\/index)/i, '/ public app shell');
  assertNoMisleadingCopy(home.text, '/ public app shell');
  logCheck('public-app-shell', true, 'root HTML reachable and copy-safe');

  const legalPages = [
    { path: '/privacy-policy', label: 'privacy-policy', required: [/Privacy Policy/i, /Data Controller/i, /docs\/privacy\/privacy-policy\.md/i] },
    { path: '/cookie-policy', label: 'cookie-policy', required: [/Cookie Policy/i, /Consent Management/i, /docs\/privacy\/cookie-policy\.md/i] },
    { path: '/terms', label: 'terms', required: [/Terms and Conditions/i, /Soft-launch transparency/i, /public cached deals/i] }
  ];
  for (const page of legalPages) {
    const result = await fetchText(`${origin}${page.path}`);
    assertSecurityHeaders(result.response.headers);
    for (const pattern of page.required) assertContains(result.text, pattern, page.label);
    assertNoMisleadingCopy(result.text, page.label);
    logCheck(`legal-${page.label}`, true);
  }

  const billingConfig = await fetchJson(`${origin}/api/billing/public-config`);
  if (billingConfig.payload?.billingProvider && billingConfig.payload.billingProvider !== 'stripe') {
    fail('Unexpected billing provider in public config', String(billingConfig.payload.billingProvider));
  }
  if (!billingConfig.payload || typeof billingConfig.payload !== 'object') {
    fail('/api/billing/public-config did not return JSON object');
  }
  logCheck('billing-public-config', true, 'pricing surface reachable');

  await fetchJson(`${origin}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ping: true }),
    expectStatuses: [400, 401]
  });
  logCheck('billing-webhook-route', true, 'reachable (expects signed requests)');

  await fetchJson(`${origin}/api/auth/me`, { expectStatuses: [401, 403] });
  logCheck('auth-surface', true, '/api/auth/me rejects anonymous users');

  const publicDeals = await fetchJson(`${origin}/api/free/public-deals?limit=10`);
  if (!Array.isArray(publicDeals.payload?.items)) fail('/api/free/public-deals did not return items array');
  if (publicDeals.payload.items.length > 10) fail('/api/free/public-deals returned more than 10 deals');
  if (!['cached_public_scan', 'demo_snapshot'].includes(String(publicDeals.payload?.dataSource || ''))) {
    fail('/api/free/public-deals returned unexpected dataSource', String(publicDeals.payload?.dataSource || 'missing'));
  }
  if (publicDeals.payload?.aiUsed !== false || publicDeals.payload?.liveProviderUsed !== false || publicDeals.payload?.cachedOnly !== true) {
    fail('/api/free/public-deals must be cached-only with no AI/live provider usage');
  }
  logCheck('free-public-deals', true, `dataSource=${String(publicDeals.payload?.dataSource || 'n/a')}`);

  const routeInsight = await fetchJson(`${origin}/api/free/route-insight?from=ROM&to=TYO`);
  if (!['cached_public_scan', 'cached_only'].includes(String(routeInsight.payload?.dataSource || ''))) {
    fail('/api/free/route-insight returned non-cached dataSource', String(routeInsight.payload?.dataSource || 'missing'));
  }
  if (!routeInsight.payload?.status || !routeInsight.payload?.message) {
    fail('/api/free/route-insight missing deterministic status/message');
  }
  assertNoMisleadingCopy(routeInsight.payload.message, '/api/free/route-insight message');
  logCheck('free-route-insight', true, `status=${String(routeInsight.payload?.status || 'n/a')}`);

  const freeRefresh = await fetchJson(`${origin}/api/free/radar/refresh`, { method: 'POST', expectStatuses: [403] });
  if (freeRefresh.payload?.code !== 'LIVE_REFRESH_REQUIRES_PRO') {
    fail('/api/free/radar/refresh did not return LIVE_REFRESH_REQUIRES_PRO', JSON.stringify(freeRefresh.payload || {}));
  }
  assertNoMisleadingCopy(freeRefresh.payload?.message || '', '/api/free/radar/refresh message');
  logCheck('free-radar-refresh-blocked', true);

  const anonymousAi = await fetchJson(`${origin}/api/search/decision/just-go`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aiProvider: 'openai' }),
    expectStatuses: [403]
  });
  if (anonymousAi.payload?.code !== 'AI_NOT_AVAILABLE_ON_FREE') {
    fail('/api/search/decision/just-go anonymous AI was not blocked as Free-cost guard', JSON.stringify(anonymousAi.payload || {}));
  }
  logCheck('anonymous-ai-blocked', true);

  await writePassEvidence({
    origin,
    hostname,
    dns,
    certRemainingDays: remainingDays,
    capabilities: caps
  });

  console.log('\n[prod-external-audit] completed successfully');
}

run().catch((error) => {
  console.error('\n[prod-external-audit] failed');
  console.error(error?.message || error);
  process.exit(1);
});
