import pino from 'pino';
import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { anonymizeIpForLogs, hashValueForLogs, redactUrlForLogs, sanitizeHeaderLikeValue } from './log-redaction.js';

const isProd = process.env.NODE_ENV === 'production';
const logDir = resolve(process.cwd(), 'data', 'logs');
mkdirSync(logDir, { recursive: true });
const logFilePath = resolve(logDir, 'app.log');
const errorLogFilePath = resolve(logDir, 'error.log');
const securityLogFilePath = resolve(logDir, 'security.log');
const LOG_ROTATION_MAX_BYTES = Math.max(1, Number(process.env.LOG_ROTATION_MAX_BYTES || 20 * 1024 * 1024));
const LOG_RETENTION_DAYS = Math.max(1, Number(process.env.LOG_RETENTION_DAYS || 14));
const LOG_ROTATION_INTERVAL_MS = Math.max(60_000, Number(process.env.LOG_ROTATION_INTERVAL_MS || 60 * 60 * 1000));
const REQUEST_LOG_SUCCESS_SAMPLE_RATE = Math.max(0, Math.min(1, Number(process.env.REQUEST_LOG_SUCCESS_SAMPLE_RATE || 0.2)));
const REQUEST_LOG_SLOW_MS = Math.max(50, Number(process.env.REQUEST_LOG_SLOW_MS || 1200));
const REQUEST_LOG_EXPECTED_5XX_ENDPOINT_PREFIXES = String(
  process.env.REQUEST_LOG_EXPECTED_5XX_ENDPOINT_PREFIXES || '/api/health/deploy-readiness'
)
  .split(',')
  .map((item) => String(item || '').trim())
  .filter(Boolean);
const logFileStream = pino.destination({
  dest: logFilePath,
  sync: false,
  mkdir: true
});
const errorLogFileStream = pino.destination({
  dest: errorLogFilePath,
  sync: false,
  mkdir: true
});
const securityLogFileStream = pino.destination({
  dest: securityLogFilePath,
  sync: false,
  mkdir: true
});

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
    timestamp: pino.stdTimeFunctions.isoTime
  },
  pino.multistream([
    { stream: process.stdout },
    { stream: logFileStream },
    { level: 'error', stream: errorLogFileStream },
    { level: 'warn', stream: securityLogFileStream }
  ])
);

function timestampSuffix() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function cleanupOldRotations(filePath) {
  const rootName = basename(filePath);
  const prefix = `${rootName}.`;
  const maxAgeMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const threshold = Date.now() - maxAgeMs;

  for (const entry of readdirSync(logDir)) {
    if (!entry.startsWith(prefix)) continue;
    const fullPath = resolve(logDir, entry);
    try {
      const stats = statSync(fullPath);
      if (stats.mtimeMs < threshold) unlinkSync(fullPath);
    } catch {
      // Non-fatal cleanup best effort.
    }
  }
}

function rotateIfNeeded(stream, filePath) {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size < LOG_ROTATION_MAX_BYTES) return;
    const rotatedPath = `${filePath}.${timestampSuffix()}`;
    renameSync(filePath, rotatedPath);
    if (typeof stream.reopen === 'function') stream.reopen(filePath);
    cleanupOldRotations(filePath);
    logger.info(
      { category: 'observability', file: basename(filePath), sizeBytes: stats.size, rotatedTo: basename(rotatedPath) },
      'log_rotated'
    );
  } catch (error) {
    logger.warn({ category: 'observability', file: basename(filePath), err: error?.message || String(error) }, 'log_rotation_failed');
  }
}

function runLogMaintenance() {
  rotateIfNeeded(logFileStream, logFilePath);
  rotateIfNeeded(errorLogFileStream, errorLogFilePath);
  rotateIfNeeded(securityLogFileStream, securityLogFilePath);
}

runLogMaintenance();
setInterval(runLogMaintenance, LOG_ROTATION_INTERVAL_MS).unref();

function normalizeEndpointPath(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const queryIdx = text.indexOf('?');
  const noQuery = queryIdx >= 0 ? text.slice(0, queryIdx) : text;
  const hashIdx = noQuery.indexOf('#');
  return hashIdx >= 0 ? noQuery.slice(0, hashIdx) : noQuery;
}

function isExpected5xxEndpoint(endpointPath) {
  if (!endpointPath || REQUEST_LOG_EXPECTED_5XX_ENDPOINT_PREFIXES.length === 0) return false;
  return REQUEST_LOG_EXPECTED_5XX_ENDPOINT_PREFIXES.some(
    (prefix) => endpointPath === prefix || endpointPath.startsWith(`${prefix}/`)
  );
}

export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const endpoint = redactUrlForLogs(req.originalUrl || req.url, { preserveOrigin: false, maxLength: 260 });
    const payload = {
      user_id: req.user?.sub || req.user?.id || null,
      request_id: req.id || null,
      method: req.method,
      endpoint,
      status_code: res.statusCode,
      ip_hash: anonymizeIpForLogs(req.ip || req.socket?.remoteAddress || ''),
      user_agent: sanitizeHeaderLikeValue(req.headers['user-agent'] || '', { maxLength: 220 }),
      referer: redactUrlForLogs(req.headers.referer || '', { preserveOrigin: true, maxLength: 240 }),
      durationMs: Number(durationMs.toFixed(2))
    };
    const endpointPath = normalizeEndpointPath(payload.endpoint);

    if (res.statusCode >= 500) {
      if (isExpected5xxEndpoint(endpointPath)) {
        logger.warn({ ...payload, expected_status: true }, 'request_warning_expected_5xx');
        return;
      }
      logger.error(payload, 'request_failed');
      return;
    }
    if (res.statusCode >= 400) {
      logger.warn(payload, 'request_warning');
      return;
    }
    const isSlowRequest = payload.durationMs >= REQUEST_LOG_SLOW_MS;
    if (isSlowRequest || Math.random() < REQUEST_LOG_SUCCESS_SAMPLE_RATE) {
      logger.info(payload, isSlowRequest ? 'request_completed_slow' : 'request_completed');
    }
  });

  return next();
}

export function logAuthEvent(payload, event = 'auth_event') {
  const safePayload = { ...payload };
  if (safePayload.email) {
    safePayload.email_hash = hashValueForLogs(String(safePayload.email || '').toLowerCase(), { label: 'email', length: 16 });
  }
  delete safePayload.email;
  logger.info({ category: 'auth', ...safePayload }, event);
}

export function logSecurityEvent(payload, event = 'security_event') {
  logger.warn({ category: 'security', ...payload }, event);
}

export function logSystemError(payload, event = 'system_error') {
  logger.error({ category: 'system', ...payload }, event);
}
