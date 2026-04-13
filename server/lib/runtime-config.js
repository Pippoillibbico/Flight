const PLACEHOLDER_PATTERNS = [
  'replace-with',
  'example.com',
  'changeme',
  'your-',
  'todo'
];

function valueLooksPlaceholder(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (!value) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => value.includes(pattern));
}

function hasMinLength(rawValue, min) {
  return String(rawValue || '').trim().length >= min;
}

function isLikelyUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:', 'postgres:', 'postgresql:', 'redis:', 'rediss:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function evaluateCheck({ key, label, severity, validator, detailOnFail, detailOnPass }, env) {
  const rawValue = env[key];
  const ok = Boolean(validator(rawValue, env));
  return {
    key,
    label,
    severity,
    ok,
    detail: ok ? detailOnPass : detailOnFail
  };
}

const CHECKS = [
  {
    key: 'BILLING_PROVIDER',
    label: 'Billing provider selection',
    severity: 'recommended',
    validator: (value) => {
      const normalized = String(value || 'stripe').trim().toLowerCase();
      return ['stripe', 'braintree'].includes(normalized);
    },
    detailOnFail: 'use BILLING_PROVIDER=stripe or BILLING_PROVIDER=braintree',
    detailOnPass: 'configured'
  },
  {
    key: 'JWT_SECRET',
    label: 'JWT signing secret',
    severity: 'blocking',
    validator: (value) => hasMinLength(value, 32) && !valueLooksPlaceholder(value),
    detailOnFail: 'missing, weak (<32), or placeholder value',
    detailOnPass: 'configured'
  },
  {
    key: 'AUDIT_LOG_HMAC_KEY',
    label: 'Immutable audit HMAC key',
    severity: 'blocking',
    validator: (value) => hasMinLength(value, 24) && !valueLooksPlaceholder(value),
    detailOnFail: 'missing or placeholder value',
    detailOnPass: 'configured'
  },
  {
    key: 'INTERNAL_INGEST_TOKEN',
    label: 'Internal ingestion token',
    severity: 'blocking',
    validator: (value) => hasMinLength(value, 24) && !valueLooksPlaceholder(value),
    detailOnFail: 'missing or placeholder value',
    detailOnPass: 'configured'
  },
  {
    key: 'FRONTEND_ORIGIN',
    label: 'Frontend public origin',
    severity: 'blocking',
    validator: (value) => isLikelyUrl(value) && !valueLooksPlaceholder(value),
    detailOnFail: 'missing or invalid URL',
    detailOnPass: 'configured'
  },
  {
    key: 'DATABASE_URL',
    label: 'Primary SQL database URL',
    severity: 'blocking',
    validator: (value) => isLikelyUrl(value) && !valueLooksPlaceholder(value),
    detailOnFail: 'missing or invalid URL',
    detailOnPass: 'configured'
  },
  {
    key: 'REDIS_URL',
    label: 'Redis cache URL',
    severity: 'blocking',
    validator: (value) => isLikelyUrl(value) && !valueLooksPlaceholder(value),
    detailOnFail: 'missing or invalid URL',
    detailOnPass: 'configured'
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET',
    label: 'Stripe webhook secret',
    severity: 'recommended',
    validator: (value, env) => {
      if (!String(env.STRIPE_SECRET_KEY || '').trim()) return true;
      return hasMinLength(value, 12) && !valueLooksPlaceholder(value);
    },
    detailOnFail: 'required when Stripe billing is enabled',
    detailOnPass: 'configured or Stripe not enabled'
  },
  {
    key: 'SMTP_HOST',
    label: 'SMTP host',
    severity: 'recommended',
    validator: (value) => String(value || '').trim().length > 0,
    detailOnFail: 'missing (password reset emails will not be delivered)',
    detailOnPass: 'configured'
  },
  {
    key: 'SMTP_USER',
    label: 'SMTP user',
    severity: 'recommended',
    validator: (value) => String(value || '').trim().length > 0,
    detailOnFail: 'missing (password reset emails will not be delivered)',
    detailOnPass: 'configured'
  },
  {
    key: 'SMTP_PASS',
    label: 'SMTP password',
    severity: 'recommended',
    validator: (value) => String(value || '').trim().length > 0,
    detailOnFail: 'missing (password reset emails will not be delivered)',
    detailOnPass: 'configured'
  },
  {
    key: 'TRUST_PROXY',
    label: 'Reverse proxy trust policy',
    severity: 'recommended',
    validator: (value, env) => {
      if (String(env.NODE_ENV || '').trim().toLowerCase() !== 'production') return true;
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) return false;
      if (['false', '0'].includes(normalized)) return false;
      return true;
    },
    detailOnFail: 'set TRUST_PROXY explicitly in production (e.g. 1 behind a single reverse proxy)',
    detailOnPass: 'configured'
  }
];

export function getRuntimeConfigAudit(env = process.env) {
  const checks = CHECKS.map((check) => evaluateCheck(check, env));
  const billingProvider = String(env.BILLING_PROVIDER || 'stripe').trim().toLowerCase();
  if (billingProvider === 'braintree') {
    checks.push(
      evaluateCheck(
        {
          key: 'BT_MERCHANT_ID',
          label: 'Braintree merchant ID',
          severity: 'blocking',
          validator: (value) => hasMinLength(value, 6) && !valueLooksPlaceholder(value),
          detailOnFail: 'missing or placeholder value',
          detailOnPass: 'configured'
        },
        env
      )
    );
    checks.push(
      evaluateCheck(
        {
          key: 'BT_PUBLIC_KEY',
          label: 'Braintree public key',
          severity: 'blocking',
          validator: (value) => hasMinLength(value, 6) && !valueLooksPlaceholder(value),
          detailOnFail: 'missing or placeholder value',
          detailOnPass: 'configured'
        },
        env
      )
    );
    checks.push(
      evaluateCheck(
        {
          key: 'BT_PRIVATE_KEY',
          label: 'Braintree private key',
          severity: 'blocking',
          validator: (value) => hasMinLength(value, 12) && !valueLooksPlaceholder(value),
          detailOnFail: 'missing or placeholder value',
          detailOnPass: 'configured'
        },
        env
      )
    );
    checks.push(
      evaluateCheck(
        {
          key: 'BT_ENVIRONMENT',
          label: 'Braintree environment',
          severity: 'blocking',
          validator: (value) => ['sandbox', 'production'].includes(String(value || '').trim().toLowerCase()),
          detailOnFail: 'must be sandbox or production',
          detailOnPass: 'configured'
        },
        env
      )
    );
  }
  const blocking = checks.filter((item) => item.severity === 'blocking');
  const recommended = checks.filter((item) => item.severity === 'recommended');
  const blockingFailed = blocking.filter((item) => !item.ok);
  const recommendedFailed = recommended.filter((item) => !item.ok);

  return {
    ok: blockingFailed.length === 0,
    summary: {
      total: checks.length,
      passed: checks.filter((item) => item.ok).length,
      failed: checks.filter((item) => !item.ok).length,
      blockingFailed: blockingFailed.length,
      recommendedFailed: recommendedFailed.length
    },
    checks,
    blockingFailedKeys: blockingFailed.map((item) => item.key),
    recommendedFailedKeys: recommendedFailed.map((item) => item.key)
  };
}
