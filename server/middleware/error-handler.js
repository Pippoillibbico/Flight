import { logger } from '../lib/logger.js';
import { redactUrlForLogs } from '../lib/log-redaction.js';

const isProd = process.env.NODE_ENV === 'production';

export function getErrorStatus(err) {
  const status = Number(err?.status || err?.statusCode || 500);
  if (!Number.isFinite(status) || status < 400 || status > 599) return 500;
  return status;
}

export function getErrorCode(err, status) {
  const raw = String(err?.code || err || '').trim().toLowerCase();
  if (raw === 'email_already_exists') return 'email_already_exists';
  if (raw === 'registration_disabled') return 'registration_disabled';
  if (raw === 'service_unavailable') return 'service_unavailable';
  if (raw === 'premium_required') return 'premium_required';
  if (raw === 'rate_limited' || raw === 'limit_exceeded') return 'rate_limited';
  if (raw === 'unauthorized' || raw === 'auth_required' || raw === 'auth_invalid' || raw === 'token_revoked') return 'unauthorized';
  if (raw === 'forbidden' || raw === 'request_forbidden' || raw === 'csrf_failed' || raw === 'insufficient_scope') return 'forbidden';
  if (raw === 'payload_too_large' || raw === 'entity.too.large') return 'payload_too_large';
  if (raw === 'invalid_payload' || raw === 'validation_failed') return 'invalid_payload';
  if (status === 503) return 'service_unavailable';
  if (status === 409) return 'request_conflict';
  if (status === 429) return 'rate_limited';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 402) return 'premium_required';
  if (status === 413) return 'payload_too_large';
  if (status === 400) return 'invalid_payload';
  if (status >= 500) return 'internal_error';
  return 'request_failed';
}

export function getHumanErrorMessage(code, fallbackMessage) {
  if (fallbackMessage && String(fallbackMessage).trim()) return String(fallbackMessage).trim();
  if (code === 'email_already_exists') return 'An account with this email already exists.';
  if (code === 'registration_disabled') return 'Registration is currently unavailable.';
  if (code === 'service_unavailable') return 'Service temporarily unavailable. Please try again shortly.';
  if (code === 'premium_required') return 'This feature requires a higher plan.';
  if (code === 'rate_limited') return 'Too many requests. Wait a moment and try again.';
  if (code === 'unauthorized') return 'Session expired. Please sign in again.';
  if (code === 'forbidden') return 'You do not have permission for this action.';
  if (code === 'payload_too_large') return 'The request is too large. Reduce the data sent and try again.';
  if (code === 'invalid_payload') return 'Check your input and try again.';
  return 'Something went wrong. Please try again in a moment.';
}

export function buildErrorPayload(req, { status = 500, error = 'request_failed', message = '', resetAt = null } = {}) {
  const code = getErrorCode(error, status);
  const payload = {
    error: code,
    message: getHumanErrorMessage(code, message),
    request_id: req?.id || null
  };
  if (resetAt) payload.reset_at = new Date(resetAt).toISOString();
  return payload;
}

export function errorHandler(err, req, res, _next) {
  const status = getErrorStatus(err);
  const code = getErrorCode(err, status);
  const fallbackMessage = !isProd ? String(err?.message || '').trim() : '';

  const logPayload = {
    request_id: req?.id || null,
    method: req?.method,
    path: redactUrlForLogs(req?.originalUrl || req?.url, { maxLength: 220 }),
    status,
    error_code: code
  };

  if (status >= 500) {
    logger.error({ ...logPayload, err: isProd ? undefined : err }, 'unhandled_error');
  } else {
    logger.warn(logPayload, 'handled_error');
  }

  const payload = buildErrorPayload(req, {
    status,
    error: code,
    message: fallbackMessage,
    resetAt: err?.resetAt
  });
  if (!isProd && err?.stack) payload.stack = err.stack;

  return res.status(status).json(payload);
}
