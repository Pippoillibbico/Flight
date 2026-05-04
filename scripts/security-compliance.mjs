import { spawn } from 'node:child_process';
import { access, readFile, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';

dotenv.config();

const STRICT_MODE =
  process.argv.includes('--strict') ||
  String(process.env.SECURITY_COMPLIANCE_STRICT || 'false')
    .trim()
    .toLowerCase() === 'true';
const PORT = Number(process.env.SECURITY_COMPLIANCE_PORT || 3102);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ALLOWED_ORIGIN = process.env.SECURITY_TEST_ORIGIN || 'https://app.flightsuite.test';
const BLOCKED_ORIGIN = 'http://evil.example';
const ADMIN_TEST_EMAIL =
  process.env.SECURITY_COMPLIANCE_ADMIN_EMAIL ||
  `compliance-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const DB_FILE = process.env.SECURITY_COMPLIANCE_DB_FILE || `data/db-security-compliance-${PORT}.json`;
const AUDIT_LOG_FILE = process.env.SECURITY_COMPLIANCE_AUDIT_LOG_FILE || `data/audit-log-security-compliance-${PORT}.ndjson`;
const CLEAN_DB_ARTIFACTS = String(process.env.SECURITY_COMPLIANCE_CLEAN_DB || 'true')
  .trim()
  .toLowerCase() !== 'false';
const EXPECTED_BYPASS_MISSING_KEYS = new Set(['DATABASE_URL', 'REDIS_URL']);
const PLACEHOLDER_PATTERNS = ['replace-with', 'changeme', 'example', 'placeholder', 'todo'];
const REQUIRED_GDPR_DOCS = [
  'docs/privacy/cookie-policy.md',
  'docs/privacy/registro-trattamenti.md',
  'docs/privacy/data-retention-policy.md',
  'docs/security/data-breach-72h-procedure.md'
];
const LOCAL_DATABASE_URL =
  String(process.env.SECURITY_COMPLIANCE_LOCAL_DATABASE_URL || '').trim() ||
  'postgresql://test:test@localhost:5432/test';
const LOCAL_REDIS_URL =
  String(process.env.SECURITY_COMPLIANCE_LOCAL_REDIS_URL || '').trim() ||
  'redis://localhost:6379';

function waitForExit(proc, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    proc.once('exit', finish);
    setTimeout(finish, timeoutMs).unref?.();
  });
}

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

function requiredStrictRuntimeEnv() {
  return {
    DATABASE_URL: String(process.env.DATABASE_URL || '').trim(),
    REDIS_URL: String(process.env.REDIS_URL || '').trim(),
    IP_HASH_SALT: String(process.env.IP_HASH_SALT || '').trim(),
    BACKUP_ENCRYPTION_KEY: String(process.env.BACKUP_ENCRYPTION_KEY || '').trim(),
    DATA_RETENTION_AUTH_EVENTS_DAYS: String(process.env.DATA_RETENTION_AUTH_EVENTS_DAYS || '').trim(),
    DATA_RETENTION_CLIENT_TELEMETRY_DAYS: String(process.env.DATA_RETENTION_CLIENT_TELEMETRY_DAYS || '').trim(),
    DATA_RETENTION_OUTBOUND_EVENTS_DAYS: String(process.env.DATA_RETENTION_OUTBOUND_EVENTS_DAYS || '').trim(),
    LEGAL_COMPANY_NAME: String(process.env.LEGAL_COMPANY_NAME || '').trim(),
    LEGAL_COMPANY_ADDRESS: String(process.env.LEGAL_COMPANY_ADDRESS || '').trim(),
    LEGAL_PRIVACY_EMAIL: String(process.env.LEGAL_PRIVACY_EMAIL || '').trim()
  };
}

function isStrongNonPlaceholder(value, minLength = 8) {
  const normalized = String(value || '').trim();
  if (normalized.length < minLength) return false;
  const lower = normalized.toLowerCase();
  return !PLACEHOLDER_PATTERNS.some((pattern) => lower.includes(pattern));
}

async function waitForHealth() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await complianceFetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {}
    await delay(300);
  }
  throw new Error('Server did not start in time for compliance checks.');
}

async function complianceFetch(url, init = {}) {
  const headers = {
    'x-forwarded-proto': 'https',
    ...(init.headers || {})
  };
  return fetch(url, { ...init, headers });
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
  checks.push(
    createCheck(
      'env_example_ip_hash_salt_key',
      envExampleRaw.includes('IP_HASH_SALT='),
      envExampleRaw.includes('IP_HASH_SALT=') ? 'present' : 'missing'
    )
  );
  checks.push(
    createCheck(
      'env_example_backup_encryption_key',
      envExampleRaw.includes('BACKUP_ENCRYPTION_KEY='),
      envExampleRaw.includes('BACKUP_ENCRYPTION_KEY=') ? 'present' : 'missing'
    )
  );

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

async function runGdprOperationalChecks() {
  const checks = [];
  for (const docPath of REQUIRED_GDPR_DOCS) {
    let exists = false;
    try {
      await access(docPath);
      exists = true;
    } catch {
      exists = false;
    }
    checks.push(createCheck(`gdpr_doc_${docPath}`, exists, exists ? 'present' : 'missing'));
  }

  const backupScriptRaw = await readFile('scripts/backup-postgres.mjs', 'utf8');
  const backupEncrypts = backupScriptRaw.includes('createCipheriv') && backupScriptRaw.includes('BACKUP_ENCRYPTION_KEY');
  checks.push(
    createCheck(
      'backup_postgres_encryption_implemented',
      backupEncrypts,
      backupEncrypts ? 'encryption flow present' : 'encryption flow missing'
    )
  );

  const retentionVars = [
    'DATA_RETENTION_AUTH_EVENTS_DAYS',
    'DATA_RETENTION_CLIENT_TELEMETRY_DAYS',
    'DATA_RETENTION_OUTBOUND_EVENTS_DAYS'
  ];
  const missingRetention = retentionVars.filter((key) => !String(process.env[key] || '').trim());
  checks.push(
    createCheck(
      'retention_env_configured',
      STRICT_MODE ? missingRetention.length === 0 : true,
      missingRetention.length === 0
        ? 'configured'
        : STRICT_MODE
        ? `missing=${missingRetention.join(',')}`
        : `non_strict_missing=${missingRetention.join(',')}`
    )
  );

  const legalFields = [
    ['LEGAL_COMPANY_NAME', 3],
    ['LEGAL_COMPANY_ADDRESS', 8],
    ['LEGAL_PRIVACY_EMAIL', 6]
  ];
  const weakLegal = legalFields
    .filter(([key, minLength]) => !isStrongNonPlaceholder(process.env[key], Number(minLength)))
    .map(([key]) => key);
  checks.push(
    createCheck(
      'legal_identity_fields_strong',
      STRICT_MODE ? weakLegal.length === 0 : true,
      weakLegal.length === 0
        ? 'configured'
        : STRICT_MODE
        ? `weak_or_missing=${weakLegal.join(',')}`
        : `non_strict_weak_or_missing=${weakLegal.join(',')}`
    )
  );

  return checks;
}

const strictRuntime = requiredStrictRuntimeEnv();
if (STRICT_MODE) {
  const missingStrict = Object.entries(strictRuntime)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missingStrict.length > 0) {
    console.error(`security-compliance: STRICT mode requires: ${missingStrict.join(', ')}`);
    process.exit(1);
  }
}

const child = spawn(process.execPath, ['server/index.js'], {
  env: (() => {
    const allowInsecureForTests =
      String(process.env.ALLOW_INSECURE_STARTUP_FOR_TESTS || '').trim() || (STRICT_MODE ? 'false' : 'true');
    const allowInsecureInProd =
      String(process.env.ALLOW_INSECURE_STARTUP_IN_PRODUCTION || '').trim() || (STRICT_MODE ? 'false' : 'true');
    const allowInsecureContext = String(process.env.ALLOW_INSECURE_STARTUP_TEST_CONTEXT || '').trim() || 'false';
    return {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'production',
      BILLING_PROVIDER: 'stripe',
      JWT_SECRET: process.env.JWT_SECRET || '12345678901234567890123456789012',
      ALLOW_MOCK_BILLING_UPGRADES: process.env.ALLOW_MOCK_BILLING_UPGRADES || 'false',
      INTERNAL_INGEST_TOKEN: process.env.INTERNAL_INGEST_TOKEN || 'internal_ingest_token_for_compliance_checks_1234',
      FRONTEND_ORIGIN: ALLOWED_ORIGIN,
      CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
      CORS_ORIGIN: ALLOWED_ORIGIN,
      CORS_ALLOWLIST: ALLOWED_ORIGIN,
      ADMIN_ALLOWLIST_EMAILS: ADMIN_TEST_EMAIL,
      TRUST_PROXY: process.env.TRUST_PROXY || '1',
      FLIGHT_DB_FILE: STRICT_MODE ? '' : DB_FILE,
      RUN_STARTUP_TASKS: 'false',
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_compliance_1234567890abcdef',
      STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_compliance_1234567890abcdef',
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_compliance_1234567890abcdef',
      STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO || 'price_test_pro_12eur',
      STRIPE_PRICE_CREATOR: process.env.STRIPE_PRICE_CREATOR || 'price_test_creator_22eur',
      STRIPE_ALLOW_INLINE_PRICE_DATA: process.env.STRIPE_ALLOW_INLINE_PRICE_DATA || 'false',
      ENABLE_PROVIDER_DUFFEL: process.env.ENABLE_PROVIDER_DUFFEL || 'true',
      DUFFEL_API_KEY: process.env.DUFFEL_API_KEY || 'duffel_test_key_123456789',
      SOFT_LAUNCH_PROVIDER_PROFILE: process.env.SOFT_LAUNCH_PROVIDER_PROFILE || 'true',
      SOFT_LAUNCH_AFFILIATE_PROFILE: process.env.SOFT_LAUNCH_AFFILIATE_PROFILE || 'true',
      AUDIT_LOG_HMAC_KEY: process.env.AUDIT_LOG_HMAC_KEY || 'compliance_hmac_key_for_checks_only',
      AUDIT_LOG_FILE,
      ALLOW_INSECURE_STARTUP_FOR_TESTS: allowInsecureForTests,
      ALLOW_INSECURE_STARTUP_IN_PRODUCTION: allowInsecureInProd,
      ALLOW_INSECURE_STARTUP_TEST_CONTEXT: allowInsecureContext,
      DATABASE_URL: STRICT_MODE ? strictRuntime.DATABASE_URL : LOCAL_DATABASE_URL,
      REDIS_URL: STRICT_MODE ? strictRuntime.REDIS_URL : LOCAL_REDIS_URL
    };
  })(),
  stdio: 'inherit'
});

const checks = [];

try {
  await waitForHealth();

  const healthRes = await complianceFetch(`${BASE_URL}/api/health`);
  checks.push(createCheck('health_ok', healthRes.ok, `status=${healthRes.status}`));

  const helmetRes = await complianceFetch(`${BASE_URL}/api/health`, {
    headers: { Origin: ALLOWED_ORIGIN }
  });
  const cspHeader = helmetRes.headers.get('content-security-policy');
  const xcto = helmetRes.headers.get('x-content-type-options');
  const xfo = helmetRes.headers.get('x-frame-options');
  checks.push(createCheck('helmet_headers_xcto', xcto === 'nosniff', `x-content-type-options=${xcto || 'missing'}`));
  checks.push(createCheck('helmet_headers_xfo', typeof xfo === 'string' && xfo.length > 0, `x-frame-options=${xfo || 'missing'}`));
  checks.push(createCheck('helmet_csp_present_prod', Boolean(cspHeader), cspHeader ? 'present' : 'missing'));

  const preflightAllowed = await complianceFetch(`${BASE_URL}/api/health`, {
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

  const preflightBlocked = await complianceFetch(`${BASE_URL}/api/health`, {
    method: 'OPTIONS',
    headers: {
      Origin: BLOCKED_ORIGIN,
      'Access-Control-Request-Method': 'GET'
    }
  });
  checks.push(createCheck('cors_preflight_blocked_origin', preflightBlocked.status === 403, `status=${preflightBlocked.status}`));

  let cookie = '';
  const email = ADMIN_TEST_EMAIL;
  const registerRes = await complianceFetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
    body: JSON.stringify({ name: 'Compliance User', email, password: 'Aa!23456789' })
  });
  const registerBody = await registerRes.json();
  const csrf = registerBody?.session?.csrfToken || '';
  cookie = mergeSetCookie(cookie, registerRes.headers.getSetCookie?.() || []);
  checks.push(createCheck('csrf_register_session', registerRes.status === 201 && Boolean(csrf), `status=${registerRes.status}, csrf=${csrf ? 'present' : 'missing'}`));

  const csrfMissing = await complianceFetch(`${BASE_URL}/api/notifications/read-all`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN }
  });
  checks.push(createCheck('csrf_enforced_missing_token', csrfMissing.status === 403, `status=${csrfMissing.status}`));

  const csrfWrongOrigin = await complianceFetch(`${BASE_URL}/api/notifications/read-all`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: BLOCKED_ORIGIN, 'X-CSRF-Token': csrf }
  });
  checks.push(createCheck('csrf_enforced_wrong_origin', csrfWrongOrigin.status === 403, `status=${csrfWrongOrigin.status}`));

  const csrfOk = await complianceFetch(`${BASE_URL}/api/notifications/read-all`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN, 'X-CSRF-Token': csrf }
  });
  checks.push(createCheck('csrf_enforced_valid_token', csrfOk.status === 204, `status=${csrfOk.status}`));

  const refreshMissing = await complianceFetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  checks.push(createCheck('refresh_requires_origin_csrf', refreshMissing.status === 403, `status=${refreshMissing.status}`));

  const refreshOk = await complianceFetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN, 'X-CSRF-Token': csrf }
  });
  checks.push(createCheck('refresh_accepts_origin_csrf', refreshOk.status === 200, `status=${refreshOk.status}`));

  const sqliAttempt = await complianceFetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
    body: JSON.stringify({ email: "' OR 1=1 --@example.com", password: 'anything123' })
  });
  checks.push(createCheck('pentest_sqli_login_no_500', sqliAttempt.status !== 500, `status=${sqliAttempt.status}`));

  const malformedJson = await complianceFetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
    body: '{"email":"bad@example.com", "password": "Aa!23456789"'
  });
  const malformedBody = await malformedJson.text();
  checks.push(createCheck('pentest_malformed_json_no_500', malformedJson.status >= 400 && malformedJson.status < 500, `status=${malformedJson.status}`));
  checks.push(createCheck('pentest_no_stack_leak', assertSafeErrorBody(malformedBody), 'response body sanitized'));

  const securityHealth = await complianceFetch(`${BASE_URL}/api/health/security`, {
    headers: { Cookie: cookie, Origin: ALLOWED_ORIGIN }
  });
  const securityPayload = await securityHealth.json();
  const securityChecks = Array.isArray(securityPayload?.checks) ? securityPayload.checks : [];
  const ignoredWhenBypass = STRICT_MODE ? new Set() : new Set(['runtime_config_blocking']);
  const failedCriticalChecks = securityChecks.filter((item) => !item.ok && !ignoredWhenBypass.has(String(item.id || '')));
  checks.push(
    createCheck(
      'security_health_endpoint_ok',
      securityHealth.ok && failedCriticalChecks.length === 0,
      `status=${securityHealth.status}, criticalFailed=${failedCriticalChecks.length}`
    )
  );

  const runtimeBlockingCheck = securityChecks.find((item) => String(item.id || '') === 'runtime_config_blocking');
  const startupPolicyCheck = securityChecks.find((item) => String(item.id || '') === 'startup_policy');
  const runtimeMissingKeys = String(runtimeBlockingCheck?.detail || '')
    .replace(/^missing=/i, '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const runtimeMissingSet = new Set(runtimeMissingKeys);
  const hasOnlyExpectedBypassMissingKeys =
    runtimeMissingSet.size === EXPECTED_BYPASS_MISSING_KEYS.size &&
    [...EXPECTED_BYPASS_MISSING_KEYS].every((key) => runtimeMissingSet.has(key));

  if (STRICT_MODE) {
    checks.push(
      createCheck(
        'startup_policy_strict_mode',
        Boolean(startupPolicyCheck?.ok),
        startupPolicyCheck?.detail || 'startup policy check missing'
      )
    );
    checks.push(
      createCheck(
        'runtime_blocking_strict_mode',
        Boolean(runtimeBlockingCheck?.ok),
        runtimeBlockingCheck?.detail || 'runtime blocking check missing'
      )
    );
  } else {
    checks.push(
      createCheck(
        'startup_policy_no_bypass_needed',
        Boolean(startupPolicyCheck?.ok),
        startupPolicyCheck?.detail || 'startup policy check missing'
      )
    );
    checks.push(
      createCheck(
        'runtime_blocking_bypass_scoped',
        Boolean(runtimeBlockingCheck?.ok) ||
          (runtimeBlockingCheck && runtimeBlockingCheck.ok === false && hasOnlyExpectedBypassMissingKeys),
        runtimeBlockingCheck?.ok
          ? 'runtime blocking checks passed without bypass'
          : `missing=${runtimeMissingKeys.join(',') || 'none'}`
      )
    );
  }

  const envChecks = await runEnvAuditChecks();
  checks.push(...envChecks);
  const gdprChecks = await runGdprOperationalChecks();
  checks.push(...gdprChecks);

  if (STRICT_MODE) {
    checks.push(
      createCheck(
        'strict_ip_hash_salt_strength',
        isStrongNonPlaceholder(process.env.IP_HASH_SALT, 16),
        isStrongNonPlaceholder(process.env.IP_HASH_SALT, 16) ? 'ok' : 'weak_or_missing'
      )
    );
    checks.push(
      createCheck(
        'strict_backup_encryption_key_strength',
        isStrongNonPlaceholder(process.env.BACKUP_ENCRYPTION_KEY, 24),
        isStrongNonPlaceholder(process.env.BACKUP_ENCRYPTION_KEY, 24) ? 'ok' : 'weak_or_missing'
      )
    );
  }

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
  await waitForExit(child);
  if (CLEAN_DB_ARTIFACTS) {
    await Promise.allSettled([
      unlink(DB_FILE),
      unlink(`${DB_FILE}.bak`),
      unlink(AUDIT_LOG_FILE),
      unlink(`${AUDIT_LOG_FILE}.lock`)
    ]);
  }
}
