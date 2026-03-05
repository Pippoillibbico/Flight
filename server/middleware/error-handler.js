import { logger } from '../lib/logger.js';

const isProd = process.env.NODE_ENV === 'production';

export function getErrorStatus(err) {
  const status = Number(err?.status || err?.statusCode || 500);
  if (!Number.isFinite(status) || status < 400 || status > 599) return 500;
  return status;
}

export function getErrorCode(err, status) {
  const raw = String(err?.code || err || '').trim().toLowerCase();
  if (raw === 'limit_exceeded') return 'limit_exceeded';
  if (raw === 'auth_required' || raw === 'auth_invalid' || raw === 'token_revoked') return 'auth_required';
  if (raw === 'invalid_payload' || raw === 'validation_failed') return 'invalid_payload';
  if (status === 429) return 'limit_exceeded';
  if (status === 401) return 'auth_required';
  if (status === 400) return 'invalid_payload';
  if (status >= 500) return 'internal_error';
  return 'request_failed';
}

export function getHumanErrorMessage(code, fallbackMessage) {
  if (fallbackMessage && String(fallbackMessage).trim()) return String(fallbackMessage).trim();
  if (code === 'limit_exceeded') return 'Hai raggiunto il limite mensile del tuo piano. Puoi aspettare il reset o fare upgrade.';
  if (code === 'auth_required') return 'Sessione scaduta, accedi di nuovo.';
  if (code === 'invalid_payload') return 'Controlla i dati inseriti e riprova.';
  return "Ops, qualcosa e' andato storto. Riprova tra poco.";
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
    path: req?.originalUrl || req?.url,
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
