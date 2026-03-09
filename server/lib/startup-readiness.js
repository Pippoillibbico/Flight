import { getRuntimeConfigAudit } from './runtime-config.js';

function parseCorsOrigins(env) {
  return [env.CORS_ORIGIN, env.FRONTEND_ORIGIN, env.CORS_ALLOWLIST]
    .filter((value) => String(value || '').trim().length > 0)
    .join(',')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isLocalhostOrigin(origin) {
  const lower = String(origin || '').trim().toLowerCase();
  return lower.includes('localhost') || lower.includes('127.0.0.1');
}

function makeCheck(id, severity, ok, detail) {
  return { id, severity, ok: Boolean(ok), detail };
}

export function evaluateStartupReadiness(env = process.env) {
  const runtimeAudit = getRuntimeConfigAudit(env);
  const nodeEnv = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';
  const frontendOrigin = String(env.FRONTEND_ORIGIN || '').trim();
  const corsOrigins = parseCorsOrigins(env);

  const policyChecks = [];
  if (isProduction) {
    policyChecks.push(
      makeCheck(
        'frontend_origin_https',
        'blocking',
        frontendOrigin.startsWith('https://'),
        frontendOrigin.startsWith('https://') ? 'FRONTEND_ORIGIN uses HTTPS' : 'FRONTEND_ORIGIN must be HTTPS in production'
      )
    );

    policyChecks.push(
      makeCheck(
        'cors_includes_frontend_origin',
        'blocking',
        Boolean(frontendOrigin) && corsOrigins.includes(frontendOrigin),
        Boolean(frontendOrigin) && corsOrigins.includes(frontendOrigin)
          ? 'CORS allowlist includes FRONTEND_ORIGIN'
          : 'CORS allowlist must include FRONTEND_ORIGIN in production'
      )
    );

    const localEntries = corsOrigins.filter((origin) => isLocalhostOrigin(origin));
    policyChecks.push(
      makeCheck(
        'cors_no_localhost',
        'blocking',
        localEntries.length === 0,
        localEntries.length === 0 ? 'no localhost entries in CORS allowlist' : `remove localhost entries: ${localEntries.join(', ')}`
      )
    );
  } else {
    policyChecks.push(makeCheck('non_production_mode', 'recommended', true, `NODE_ENV=${nodeEnv}`));
  }

  const blockingPolicy = policyChecks.filter((item) => item.severity === 'blocking' && !item.ok);
  const recommendedPolicy = policyChecks.filter((item) => item.severity !== 'blocking' && !item.ok);

  return {
    ok: runtimeAudit.ok && blockingPolicy.length === 0,
    runtimeAudit,
    policyChecks,
    summary: {
      runtime: runtimeAudit.summary,
      policy: {
        total: policyChecks.length,
        failed: policyChecks.filter((item) => !item.ok).length,
        blockingFailed: blockingPolicy.length,
        recommendedFailed: recommendedPolicy.length
      }
    },
    blockingFailed: {
      runtime: runtimeAudit.blockingFailedKeys,
      policy: blockingPolicy.map((item) => item.id)
    },
    recommendedFailed: {
      runtime: runtimeAudit.recommendedFailedKeys,
      policy: recommendedPolicy.map((item) => item.id)
    }
  };
}
