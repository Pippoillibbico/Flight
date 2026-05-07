import { parseFlag } from '../env-flags.js';

const PLACEHOLDER_TOKENS = ['replace-with', 'changeme', 'your-', 'example.com', 'todo'];

function hasValue(value, min = 1) {
  return String(value || '').trim().length >= min;
}

function looksPlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PLACEHOLDER_TOKENS.some((token) => normalized.includes(token));
}

export function isEmailDryRun(env = process.env) {
  return parseFlag(env.EMAIL_DRY_RUN, true);
}

export function getEmailProviderName(env = process.env) {
  const provider = String(env.EMAIL_PROVIDER || 'smtp').trim().toLowerCase();
  return provider || 'smtp';
}

export function getEmailReadiness(env = process.env) {
  const provider = getEmailProviderName(env);
  const dryRun = isEmailDryRun(env);
  const smtpConfigured =
    provider === 'smtp' &&
    hasValue(env.SMTP_HOST) &&
    hasValue(env.SMTP_USER) &&
    hasValue(env.SMTP_PASS) &&
    !looksPlaceholder(env.SMTP_HOST) &&
    !looksPlaceholder(env.SMTP_USER) &&
    !looksPlaceholder(env.SMTP_PASS);

  if (dryRun) {
    return {
      status: 'EMAIL_DRY_RUN',
      provider,
      dryRun: true,
      smtpConfigured,
      canSendRealEmail: false,
      reason: 'EMAIL_DRY_RUN=true'
    };
  }

  if (provider === 'smtp' && smtpConfigured) {
    return {
      status: 'EMAIL_READY',
      provider,
      dryRun: false,
      smtpConfigured: true,
      canSendRealEmail: true,
      reason: null
    };
  }

  return {
    status: 'EMAIL_NOT_CONFIGURED',
    provider,
    dryRun: false,
    smtpConfigured: false,
    canSendRealEmail: false,
    reason: provider === 'smtp' ? 'SMTP_HOST/SMTP_USER/SMTP_PASS missing' : `Unsupported EMAIL_PROVIDER=${provider}`
  };
}

export function assertEmailReadinessForProduction(env = process.env) {
  const readiness = getEmailReadiness(env);
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (isProduction && !readiness.dryRun && readiness.status !== 'EMAIL_READY') {
    throw Object.assign(new Error('email_not_configured_for_production'), {
      code: 'EMAIL_NOT_CONFIGURED',
      readiness
    });
  }
  return readiness;
}
