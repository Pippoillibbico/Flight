import { parseFlag } from './env-flags.js';

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

function parseList(rawValue) {
  return String(rawValue || '')
    .split(/[,\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInt(rawValue, fallback = 0) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function normalizeOrigin(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function parseCorsOrigins(env) {
  const combined = [
    ...parseList(env?.CORS_ORIGIN),
    ...parseList(env?.FRONTEND_ORIGIN),
    ...parseList(env?.CORS_ALLOWLIST),
    String(env?.FRONTEND_URL || '').trim()
  ]
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);
  return Array.from(new Set(combined));
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

function isValidBillingProvider(rawValue, env) {
  const value = String(rawValue || '').trim().toLowerCase();
  const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (!isProduction) return !value || value === 'stripe';
  return value === 'stripe';
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
    validator: (value, env) => isValidBillingProvider(value, env),
    detailOnFail: 'production requires BILLING_PROVIDER=stripe',
    detailOnPass: 'configured'
  },
  {
    key: 'STRIPE_SECRET_KEY',
    label: 'Stripe secret key',
    severity: 'blocking',
    validator: (value, env) => {
      const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
      const provider = String(env?.BILLING_PROVIDER || '').trim().toLowerCase();
      const billingActive = isProduction && provider === 'stripe';
      if (!billingActive) return true;
      return hasMinLength(value, 16) && !valueLooksPlaceholder(value);
    },
    detailOnFail: 'required in production when BILLING_PROVIDER=stripe',
    detailOnPass: 'configured or non-production'
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
    key: 'OUTBOUND_CLICK_SECRET',
    label: 'Outbound click HMAC secret',
    severity: 'blocking',
    validator: (value, env) => {
      const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      const outboundSecret = String(value || '').trim();
      if (!hasMinLength(outboundSecret, 24) || valueLooksPlaceholder(outboundSecret)) return false;
      const jwtSecret = String(env?.JWT_SECRET || '').trim();
      return !jwtSecret || outboundSecret !== jwtSecret;
    },
    detailOnFail: 'production requires OUTBOUND_CLICK_SECRET (>=24 chars), non-placeholder, and distinct from JWT_SECRET',
    detailOnPass: 'configured'
  },
  {
    key: 'ALLOW_MOCK_BILLING_UPGRADES',
    label: 'Mock billing upgrade routes disabled in production',
    severity: 'blocking',
    validator: (value, env) => {
      const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      return !parseFlag(value, false);
    },
    detailOnFail: 'set ALLOW_MOCK_BILLING_UPGRADES=false in production',
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
    key: 'CORS_ORIGIN',
    label: 'CORS allowlist origin coverage',
    severity: 'blocking',
    validator: (_value, env) => {
      const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      return parseCorsOrigins(env).length > 0;
    },
    detailOnFail: 'set FRONTEND_ORIGIN or CORS_ALLOWLIST/CORS_ORIGIN to at least one valid https origin',
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
    // blocking when Stripe key is present AND we are in production; recommended otherwise
    severity: 'blocking',
    validator: (value, env) => {
      const hasStripeKey = hasMinLength(env.STRIPE_SECRET_KEY, 16);
      if (!hasStripeKey) return true; // Stripe not configured -> always pass
      const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true; // dev/staging -> pass (shows only as recommended gap)
      return hasMinLength(value, 12) && !valueLooksPlaceholder(value);
    },
    detailOnFail: 'required in production when STRIPE_SECRET_KEY is configured',
    detailOnPass: 'configured or Stripe/production not active'
  },
  {
    key: 'STRIPE_PUBLISHABLE_KEY',
    label: 'Stripe publishable key',
    severity: 'blocking',
    validator: (value, env) => {
      const hasStripeKey = hasMinLength(env.STRIPE_SECRET_KEY, 16);
      if (!hasStripeKey) return true;
      const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      return hasMinLength(value, 16) && !valueLooksPlaceholder(value);
    },
    detailOnFail: 'required in production when STRIPE_SECRET_KEY is configured (needed for client-side Stripe flows)',
    detailOnPass: 'configured or Stripe not active'
  },
  {
    key: 'STRIPE_PRICE_PRO',
    label: 'Stripe PRO price id',
    severity: 'blocking',
    validator: (value, env) => {
      const hasStripeKey = hasMinLength(env.STRIPE_SECRET_KEY, 16);
      if (!hasStripeKey) return true;
      const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      return hasMinLength(value, 8) && !valueLooksPlaceholder(value);
    },
    detailOnFail: 'required in production when Stripe is active (checkout cannot sell PRO without a configured price)',
    detailOnPass: 'configured or Stripe not active'
  },
  {
    key: 'STRIPE_PRICE_CREATOR',
    label: 'Stripe CREATOR/ELITE price id',
    severity: 'blocking',
    validator: (value, env) => {
      const hasStripeKey = hasMinLength(env.STRIPE_SECRET_KEY, 16);
      if (!hasStripeKey) return true;
      const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      return hasMinLength(value, 8) && !valueLooksPlaceholder(value);
    },
    detailOnFail: 'required in production when Stripe is active (checkout cannot sell ELITE without a configured price)',
    detailOnPass: 'configured or Stripe not active'
  },
  {
    key: 'STRIPE_ALLOW_INLINE_PRICE_DATA',
    label: 'Stripe inline price-data fallback disabled in production',
    severity: 'blocking',
    validator: (value, env) => {
      const hasStripeKey = hasMinLength(env.STRIPE_SECRET_KEY, 16);
      if (!hasStripeKey) return true;
      const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      return String(value || '').trim().toLowerCase() !== 'true';
    },
    detailOnFail: 'set STRIPE_ALLOW_INLINE_PRICE_DATA=false in production',
    detailOnPass: 'configured or Stripe/production not active'
  },
  {
    key: 'AI_ALLOW_FREE_USERS',
    label: 'AI free-user bypass disabled in production',
    severity: 'blocking',
    validator: (value, env) => {
      const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      return !parseFlag(value, false);
    },
    detailOnFail: 'set AI_ALLOW_FREE_USERS=false in production',
    detailOnPass: 'configured'
  },
  {
    key: 'AI_BUDGET_FAIL_OPEN',
    label: 'AI budget guard fail-open disabled in production',
    severity: 'blocking',
    validator: (value, env) => {
      const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      return !parseFlag(value, false);
    },
    detailOnFail: 'set AI_BUDGET_FAIL_OPEN=false in production',
    detailOnPass: 'configured'
  },
  {
    key: 'AI_ALLOWED_PLAN_TYPES',
    label: 'AI allowed plans exclude free in production',
    severity: 'blocking',
    validator: (value, env) => {
      const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      const plans = parseList(value || 'elite,creator')
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean);
      return !plans.includes('free');
    },
    detailOnFail: 'AI_ALLOWED_PLAN_TYPES must not include free in production',
    detailOnPass: 'configured'
  },
  {
    key: 'SEARCH_PROVIDER_BUDGET_FAIL_OPEN',
    label: 'Provider budget guard fail-open disabled in production',
    severity: 'blocking',
    validator: (value, env) => {
      const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      return !parseFlag(value, false);
    },
    detailOnFail: 'set SEARCH_PROVIDER_BUDGET_FAIL_OPEN=false in production',
    detailOnPass: 'configured'
  },
  {
    key: 'PRICING_ENABLED',
    label: 'Pricing engine enabled in production',
    severity: 'blocking',
    validator: (value, env) => {
      const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      return parseFlag(value, true);
    },
    detailOnFail: 'set PRICING_ENABLED=true in production to avoid unpriced provider-cost exposure',
    detailOnPass: 'configured'
  },
  {
    key: 'MARGIN_GUARD_ENABLED',
    label: 'Margin guard enabled in production',
    severity: 'blocking',
    validator: (value, env) => {
      const isProduction = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
      if (!isProduction) return true;
      return parseFlag(value, true);
    },
    detailOnFail: 'set MARGIN_GUARD_ENABLED=true in production to prevent below-margin offers',
    detailOnPass: 'configured'
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
  const duffelEnabled = parseFlag(env.ENABLE_PROVIDER_DUFFEL, false);
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
          return duffelReady;
        },
        detailOnFail: 'scanner/provider collection enabled but no provider is fully configured',
        detailOnPass: scanEnabled || providerCollectionEnabled ? 'configured' : 'scanner/provider collection disabled'
      },
      env
    )
  );

  checks.push(
    evaluateCheck(
      {
        key: 'SOFT_LAUNCH_PROVIDER_PROFILE',
        label: 'Soft-launch provider profile (Duffel only)',
        severity: isProduction ? 'blocking' : 'recommended',
        validator: (_value, envContext) => {
          const duffel = parseFlag(envContext.ENABLE_PROVIDER_DUFFEL, false);
          const kiwi = parseFlag(envContext.ENABLE_PROVIDER_KIWI, false);
          const skyscanner = parseFlag(envContext.ENABLE_PROVIDER_SKYSCANNER, false);
          return duffel && !kiwi && !skyscanner;
        },
        detailOnFail:
          'soft-launch requires ENABLE_PROVIDER_DUFFEL=true, ENABLE_PROVIDER_KIWI=false, ENABLE_PROVIDER_SKYSCANNER=false',
        detailOnPass: 'provider profile matches soft-launch constraints'
      },
      env
    )
  );

  checks.push(
    evaluateCheck(
      {
        key: 'SOFT_LAUNCH_AFFILIATE_PROFILE',
        label: 'Soft-launch affiliate profile (Travelpayouts active)',
        severity: isProduction ? 'blocking' : 'recommended',
        validator: (_value, envContext) => {
          const enabled = parseFlag(envContext.ENABLE_TRAVELPAYOUTS_AFFILIATE, true);
          const marker = String(envContext.AFFILIATE_TRAVELPAYOUTS_MARKER || '').trim();
          return enabled && hasMinLength(marker, 4) && !valueLooksPlaceholder(marker);
        },
        detailOnFail:
          'soft-launch requires ENABLE_TRAVELPAYOUTS_AFFILIATE=true and AFFILIATE_TRAVELPAYOUTS_MARKER configured',
        detailOnPass: 'travelpayouts affiliate layer configured'
      },
      env
    )
  );

  checks.push(
    evaluateCheck(
      {
        key: 'DATA_RETENTION_AUTH_EVENTS_DAYS',
        label: 'Auth/security retention window',
        severity: 'recommended',
        validator: (_value, envContext) => parsePositiveInt(envContext.DATA_RETENTION_AUTH_EVENTS_DAYS, 180) >= 7,
        detailOnFail: 'set DATA_RETENTION_AUTH_EVENTS_DAYS to a positive value (recommended >=7)',
        detailOnPass: `configured (${parsePositiveInt(env.DATA_RETENTION_AUTH_EVENTS_DAYS, 180)} days)`
      },
      env
    )
  );

  checks.push(
    evaluateCheck(
      {
        key: 'DATA_RETENTION_CLIENT_TELEMETRY_DAYS',
        label: 'Telemetry retention window',
        severity: 'recommended',
        validator: (_value, envContext) => parsePositiveInt(envContext.DATA_RETENTION_CLIENT_TELEMETRY_DAYS, 120) >= 7,
        detailOnFail: 'set DATA_RETENTION_CLIENT_TELEMETRY_DAYS to a positive value (recommended >=7)',
        detailOnPass: `configured (${parsePositiveInt(env.DATA_RETENTION_CLIENT_TELEMETRY_DAYS, 120)} days)`
      },
      env
    )
  );

  checks.push(
    evaluateCheck(
      {
        key: 'DATA_RETENTION_OUTBOUND_EVENTS_DAYS',
        label: 'Outbound event retention window',
        severity: 'recommended',
        validator: (_value, envContext) => parsePositiveInt(envContext.DATA_RETENTION_OUTBOUND_EVENTS_DAYS, 180) >= 7,
        detailOnFail: 'set DATA_RETENTION_OUTBOUND_EVENTS_DAYS to a positive value (recommended >=7)',
        detailOnPass: `configured (${parsePositiveInt(env.DATA_RETENTION_OUTBOUND_EVENTS_DAYS, 180)} days)`
      },
      env
    )
  );

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

