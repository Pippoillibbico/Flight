import { logger } from '../lib/logger.js';

function getStatus(err) {
  const status = Number(err?.status || err?.statusCode || 500);
  if (!Number.isFinite(status) || status < 400 || status > 599) return 500;
  return status;
}

function getCode(err, status) {
  const raw = String(err?.code || '').trim().toLowerCase();
  if (raw === 'limit_exceeded') return 'limit_exceeded';
  if (raw === 'auth_required' || raw === 'auth_invalid' || raw === 'token_revoked') return 'auth_required';
  if (raw === 'invalid_payload' || raw === 'validation_failed') return 'invalid_payload';
  if (status === 429) return 'limit_exceeded';
  if (status === 401) return 'auth_required';
  if (status === 400) return 'invalid_payload';
  if (status >= 500) return 'internal_error';
  return 'request_failed';
}

function getMessage(err, _status, code) {
  const raw = String(err?.message || '').trim();
  if (code === 'limit_exceeded') return 'Hai superato il limite del piano questo mese. Upgrade per continuare.';
  if (code === 'auth_required') return 'Accedi per continuare.';
  if (code === 'invalid_payload') return raw || 'Controlla i dati inseriti e riprova.';
  if (code === 'internal_error') return 'Si è verificato un errore interno. Riprova tra poco.';
  return raw || 'Richiesta non disponibile al momento. Riprova.';
}

export function errorHandler(err, req, res, _next) {
  const status = getStatus(err);
  const code = getCode(err, status);
  const message = getMessage(err, status, code);

  const logPayload = {
    request_id: req?.id || null,
    method: req?.method,
    path: req?.originalUrl || req?.url,
    status,
    error_code: code
  };

  if (status >= 500) {
    logger.error({ ...logPayload, err: process.env.NODE_ENV === 'production' ? undefined : err }, 'unhandled_error');
  } else {
    logger.warn(logPayload, 'handled_error');
  }

  const payload = {
    error: code,
    message,
    request_id: req?.id || null
  };
  if (err?.resetAt) payload.reset_at = new Date(err.resetAt).toISOString();

  return res.status(status).json(payload);
}
