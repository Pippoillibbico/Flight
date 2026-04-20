function withInfraTimeout(promise, timeoutMs, label) {
  const safeTimeoutMs = Math.max(500, Number(timeoutMs) || 5000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), safeTimeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function verifyPrimaryInfrastructureOrFail({
  env,
  logger,
  pgPool,
  getCacheClient,
  requirePrimaryInfraInProduction,
  primaryInfraCheckTimeoutMs,
  insecureStartupBypassEnabled,
  allowInsecureStartupForTests,
  allowInsecureStartupInProduction,
  failFast
}) {
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (!isProduction || !requirePrimaryInfraInProduction) return;

  const failures = [];
  if (!pgPool) {
    failures.push('postgres_not_configured');
  } else {
    try {
      await withInfraTimeout(pgPool.query('SELECT 1'), primaryInfraCheckTimeoutMs, 'postgres');
    } catch (error) {
      failures.push(`postgres_unreachable:${error?.message || String(error)}`);
    }
  }

  const redisUrlConfigured = Boolean(String(env.REDIS_URL || '').trim());
  if (!redisUrlConfigured) {
    failures.push('redis_not_configured');
  } else {
    try {
      const cache = getCacheClient();
      if (typeof cache?.ping !== 'function') failures.push('redis_ping_not_supported');
      else await withInfraTimeout(cache.ping(), primaryInfraCheckTimeoutMs, 'redis');
    } catch (error) {
      failures.push(`redis_unreachable:${error?.message || String(error)}`);
    }
  }

  if (failures.length === 0) return;
  if (!insecureStartupBypassEnabled) {
    logger.fatal(
      {
        failures,
        requirePrimaryInfraInProduction: requirePrimaryInfraInProduction,
        primaryInfraCheckTimeoutMs
      },
      'startup_blocked_primary_infra_unavailable'
    );
    failFast(1);
    return;
  }

  logger.warn(
    {
      failures,
      allowInsecureStartupForTests,
      allowInsecureStartupInProduction,
      requirePrimaryInfraInProduction
    },
    'startup_primary_infra_unavailable_bypass_enabled'
  );
}

export function enforceStartupReadinessOrFail({
  env,
  logger,
  startupReadiness,
  runtimeConfigAudit,
  insecureStartupBypassEnabled,
  allowInsecureStartupForTests,
  allowInsecureStartupInProduction,
  failFast
}) {
  if (!startupReadiness?.ok && String(env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    if (!insecureStartupBypassEnabled) {
      logger.fatal(
        {
          blockingRuntimeMissing: startupReadiness?.blockingFailed?.runtime,
          blockingPolicyMissing: startupReadiness?.blockingFailed?.policy,
          summary: startupReadiness?.summary
        },
        'startup_blocked_missing_required_runtime_config'
      );
      failFast(1);
      return;
    }
    logger.warn(
      {
        allowInsecureStartupForTests,
        allowInsecureStartupInProduction,
        blockingRuntimeMissing: startupReadiness?.blockingFailed?.runtime,
        blockingPolicyMissing: startupReadiness?.blockingFailed?.policy,
        summary: startupReadiness?.summary
      },
      'startup_insecure_bypass_enabled_for_tests'
    );
  }

  if (runtimeConfigAudit?.summary?.recommendedFailed > 0) {
    logger.warn(
      {
        recommendedMissing: runtimeConfigAudit.recommendedFailedKeys,
        summary: runtimeConfigAudit.summary
      },
      'runtime_config_recommended_values_missing'
    );
  }
  if ((startupReadiness?.recommendedFailed?.policy || []).length > 0) {
    logger.warn(
      {
        recommendedPolicyMissing: startupReadiness.recommendedFailed.policy,
        policySummary: startupReadiness.summary.policy
      },
      'runtime_policy_recommended_values_missing'
    );
  }
}

export function logStartupCapabilityWarnings({
  env,
  logger
}) {
  const pushUrl = String(env.PUSH_WEBHOOK_URL || '').trim();
  if (!pushUrl) {
    logger.warn(
      { capability: 'push_notifications', impact: 'alerts_dead_lettered' },
      'startup_capability_missing_push_webhook_url: push notifications disabled, triggered alerts will be saved to dead-letter queue only. Set PUSH_WEBHOOK_URL to enable delivery.'
    );
  }

  const smtpHost = String(env.SMTP_HOST || '').trim();
  if (!smtpHost) {
    logger.warn(
      { capability: 'email_smtp', impact: 'emails_not_sent_accounts_auto_verified' },
      'startup_capability_missing_smtp: email delivery disabled. Password reset emails will not be sent. New accounts are auto-verified. Set SMTP_HOST/USER/PASS to enable.'
    );
  }

  const billingProvider = 'stripe';
  const stripeConfigured = String(env.STRIPE_SECRET_KEY || '').trim().length >= 16;
  if (!stripeConfigured) {
    logger.warn(
      { capability: 'billing', provider: billingProvider, impact: 'upgrades_unavailable' },
      `startup_capability_missing_billing: billing provider '${billingProvider}' credentials not configured. Subscription upgrades will return 503. Set STRIPE_SECRET_KEY to enable.`
    );
  }

  const flightScanEnabled = String(env.FLIGHT_SCAN_ENABLED || '').trim().toLowerCase() === 'true';
  const liveProviders = String(env.ENABLE_PROVIDER_DUFFEL || '').trim().toLowerCase() === 'true';
  if (!liveProviders) {
    logger.warn(
      { capability: 'live_flight_providers', impact: 'synthetic_data_only' },
      'startup_capability_disabled_live_providers: no live flight provider enabled. Search results and deals are based on internal synthetic data. Set ENABLE_PROVIDER_DUFFEL=true with credentials to enable live prices.'
    );
  } else if (!flightScanEnabled) {
    logger.warn(
      { capability: 'flight_scan', impact: 'providers_configured_but_scan_off' },
      'startup_capability_missing_flight_scan: live providers are configured but FLIGHT_SCAN_ENABLED=false. Provider data will not be collected. Set FLIGHT_SCAN_ENABLED=true to activate.'
    );
  }
}
