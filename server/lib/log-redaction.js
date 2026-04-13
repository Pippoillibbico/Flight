import { createHash } from 'node:crypto';

const SENSITIVE_QUERY_KEYS = new Set([
  'access_token',
  'api_key',
  'apikey',
  'authorization',
  'code',
  'csrf',
  'id_token',
  'key',
  'password',
  'refresh_token',
  'reset_token',
  'secret',
  'session',
  'signature',
  'state',
  'token'
]);

function stripControlChars(value) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ');
}

function clampText(value, maxLength) {
  const safeLength = Math.max(16, Number(maxLength) || 256);
  const normalized = stripControlChars(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= safeLength) return normalized;
  return `${normalized.slice(0, Math.max(8, safeLength - 3))}...`;
}

function normalizeQueryKey(key) {
  return String(key || '')
    .trim()
    .toLowerCase();
}

function redactQueryValue(key, value) {
  const normalizedKey = normalizeQueryKey(key);
  if (SENSITIVE_QUERY_KEYS.has(normalizedKey)) return '[REDACTED]';
  return clampText(value, 96);
}

function hasAbsoluteScheme(value) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(String(value || ''));
}

const LOG_HASH_SALT = String(process.env.LOG_HASH_SALT || process.env.JWT_SECRET || 'flight_log_salt').trim();

export function hashValueForLogs(rawValue, { label = 'id', length = 20 } = {}) {
  const safeLength = Math.max(8, Math.min(64, Number(length) || 20));
  const value = String(rawValue || '').trim();
  if (!value) return '';
  return createHash('sha256')
    .update(`${LOG_HASH_SALT}:${label}:${value}`)
    .digest('hex')
    .slice(0, safeLength);
}

export function anonymizeIpForLogs(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  return `ip_${hashValueForLogs(value, { label: 'ip', length: 16 })}`;
}

export function sanitizeHeaderLikeValue(rawValue, { maxLength = 240 } = {}) {
  return clampText(rawValue, maxLength);
}

export function redactUrlForLogs(rawValue, { preserveOrigin = false, maxLength = 320 } = {}) {
  const raw = clampText(rawValue, 4096);
  if (!raw) return '';

  try {
    const absolute = hasAbsoluteScheme(raw);
    const parsed = new URL(raw, 'http://local.invalid');

    const keys = [...new Set(Array.from(parsed.searchParams.keys()))];
    for (const key of keys) {
      const values = parsed.searchParams.getAll(key);
      parsed.searchParams.delete(key);
      for (const value of values) {
        parsed.searchParams.append(key, redactQueryValue(key, value));
      }
    }

    const base = preserveOrigin && absolute ? `${parsed.origin}${parsed.pathname}` : `${parsed.pathname}`;
    const output = `${base}${parsed.search}`;
    return clampText(output, maxLength);
  } catch {
    return clampText(raw, maxLength);
  }
}

export function redactObjectFields(input, keysToRedact = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const normalizedKeys = new Set(keysToRedact.map((key) => normalizeQueryKey(key)));
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (normalizedKeys.has(normalizeQueryKey(key))) {
      output[key] = '[REDACTED]';
      continue;
    }
    output[key] = value;
  }
  return output;
}
