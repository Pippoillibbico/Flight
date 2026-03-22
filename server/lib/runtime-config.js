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

function parseFlag(rawValue, fallback = false) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function parseList(rawValue) {
  return String(rawValue || '')
    .split(/[,\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function isValidBillingProvider(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  return !value || value === 'stripe' || value === 'braintree';
}

function resolveBillingProvider(env) {
  const value = String(env?.BILLING_PROVIDER || '').trim().toLowerCase();
  if (value === 'stripe' || value === 'braintree') return value;
  const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
  return isProduction ? 'braintree' : 'stripe';
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
    severity: 'blocking',
    validator: (value) => isValidBillingProvider(value),
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
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const billingProvider = resolveBillingProvider(env);
  const duffelEnabled = parseFlag(env.ENABLE_PROVIDER_DUFFEL, false);
  const amadeusEnabled = parseFlag(env.ENABLE_PROVIDER_AMADEUS, false);
  const scanEnabled = parseFlag(env.FLIGHT_SCAN_ENABLED, false);
  const providerCollectionEnabled = parseFlag(env.PROVIDER_COLLECTION_ENABLED, false);
  const dealsContentEnabled = parseFlag(env.DEALS_CONTENT_ENABLED, true);
  const dealsContentInAppEnabled = parseFlag(env.DEALS_CONTENT_INAPP_ENABLED, true);
  const dealsContentPushReady = isLikelyUrl(env.PUSH_WEBHOOK_URL) && !valueLooksPlaceholder(env.PUSH_WEBHOOK_URL);
  const dealsContentSocialReady =
    isLikelyUrl(env.DEALS_CONTENT_SOCIAL_WEBHOOK_URL) && !valueLooksPlaceholder(env.DEALS_CONTENT_SOCIAL_WEBHOOK_URL);
  const dealsNewsletterRecipients = parseList(env.DEALS_CONTENT_NEWSLETTER_RECIPIENTS);
  const dealsContentNewsletterReady =
    dealsNewsletterRecipients.length > 0 &&
    String(env.SMTP_HOST || '').trim().length > 0 &&
    String(env.SMTP_USER || '').trim().length > 0 &&
    String(env.SMTP_PASS || '').trim().length > 0;
  const dealsContentAtLeastOneChannel =
    dealsContentInAppEnabled || dealsContentPushReady || dealsContentSocialReady || dealsContentNewsletterReady;

  checks.push(
    evaluateCheck(
      {
        key: 'DEALS_CONTENT_DELIVERY_CHANNELS',
        label: 'Deals content delivery channels',
        severity: dealsContentEnabled && isProduction ? 'blocking' : 'recommended',
        validator: () => !dealsContentEnabled || dealsContentAtLeastOneChannel,
        detailOnFail:
          'DEALS_CONTENT enabled but no delivery channel configured (enable in-app or configure push/social/newsletter)',
        detailOnPass: !dealsContentEnabled ? 'deals content disabled' : 'at least one channel configured'
      },
      env
    )
  );

  checks.push(
    evaluateCheck(
      {
        key: 'DUFFEL_PROVIDER_CREDENTIALS',
        label: 'Duffel provider credentials',
        severity: duffelEnabled ? 'blocking' : 'recommended',
        validator: (_value, envContext) => {
          if (!parseFlag(envContext.ENABLE_PROVIDER_DUFFEL, false)) return true;
          return hasMinLength(envContext.DUFFEL_API_KEY, 8) && !valueLooksPlaceholder(envContext.DUFFEL_API_KEY);
        },
        detailOnFail: 'ENABLE_PROVIDER_DUFFEL=true requires DUFFEL_API_KEY',
        detailOnPass: duffelEnabled ? 'configured' : 'provider disabled'
      },
      env
    )
  );

  checks.push(
    evaluateCheck(
      {
        key: 'AMADEUS_PROVIDER_CREDENTIALS',
        label: 'Amadeus provider credentials',
        severity: amadeusEnabled ? 'blocking' : 'recommended',
        validator: (_value, envContext) => {
          if (!parseFlag(envContext.ENABLE_PROVIDER_AMADEUS, false)) return true;
          const clientIdOk = hasMinLength(envContext.AMADEUS_CLIENT_ID, 6) && !valueLooksPlaceholder(envContext.AMADEUS_CLIENT_ID);
          const clientSecretOk = hasMinLength(envContext.AMADEUS_CLIENT_SECRET, 8) && !valueLooksPlaceholder(envContext.AMADEUS_CLIENT_SECRET);
          return clientIdOk && clientSecretOk;
        },
        detailOnFail: 'ENABLE_PROVIDER_AMADEUS=true requires AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET',
        detailOnPass: amadeusEnabled ? 'configured' : 'provider disabled'
      },
      env
    )
  );

  checks.push(
    evaluateCheck(
      {
        key: 'AT_LEAST_ONE_PROVIDER_CONFIGURED',
        label: 'At least one provider configured when scan/collection enabled',
        severity: scanEnabled || providerCollectionEnabled ? 'blocking' : 'recommended',
        validator: (_value, envContext) => {
          const scanOrCollectionEnabled =
            parseFlag(envContext.FLIGHT_SCAN_ENABLED, false) || parseFlag(envContext.PROVIDER_COLLECTION_ENABLED, false);
          if (!scanOrCollectionEnabled) return true;

          const duffelReady =
            parseFlag(envContext.ENABLE_PROVIDER_DUFFEL, false) &&
            hasMinLength(envContext.DUFFEL_API_KEY, 8) &&
            !valueLooksPlaceholder(envContext.DUFFEL_API_KEY);
          const amadeusReady =
            parseFlag(envContext.ENABLE_PROVIDER_AMADEUS, false) &&
            hasMinLength(envContext.AMADEUS_CLIENT_ID, 6) &&
            !valueLooksPlaceholder(envContext.AMADEUS_CLIENT_ID) &&
            hasMinLength(envContext.AMADEUS_CLIENT_SECRET, 8) &&
            !valueLooksPlaceholder(envContext.AMADEUS_CLIENT_SECRET);

          return duffelReady || amadeusReady;
        },
        detailOnFail: 'scanner/provider collection enabled but no provider is fully configured',
        detailOnPass: scanEnabled || providerCollectionEnabled ? 'configured' : 'scanner/provider collection disabled'
      },
      env
    )
  );

  if (isProduction) {
    checks.push(
      evaluateCheck(
        {
          key: 'BILLING_PROVIDER_PRODUCTION_LOCK',
          label: 'Billing provider production lock',
          severity: 'blocking',
          validator: (_value, envContext) => resolveBillingProvider(envContext) === 'braintree',
          detailOnFail: 'production requires BILLING_PROVIDER=braintree for supported checkout flow',
          detailOnPass: 'configured'
        },
        env
      )
    );
  }

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
