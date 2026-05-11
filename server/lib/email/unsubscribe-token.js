import { createHmac, timingSafeEqual } from 'node:crypto';

const UNSUBSCRIBE_TYPES = new Set(['digest', 'alert', 'marketing']);

function secret(env = process.env) {
  const value = String(env.EMAIL_UNSUBSCRIBE_SECRET || env.JWT_SECRET || '').trim();
  if (value.length < 32) {
    throw new Error('EMAIL_UNSUBSCRIBE_SECRET or JWT_SECRET must be set and at least 32 characters long.');
  }
  return value;
}

function base64urlEncode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function base64urlDecode(value) {
  return Buffer.from(String(value), 'base64url').toString('utf8');
}

function signPayload(payload, env = process.env) {
  return createHmac('sha256', secret(env)).update(payload).digest('base64url');
}

function normalizeType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return UNSUBSCRIBE_TYPES.has(normalized) ? normalized : '';
}

export function createUnsubscribeToken({ userId, type, expiresInMs = 30 * 24 * 60 * 60 * 1000, env = process.env }) {
  const safeUserId = String(userId || '').trim();
  const safeType = normalizeType(type);
  if (!safeUserId || !safeType) return '';
  const expiresAt = Date.now() + Math.max(60_000, Number(expiresInMs) || 30 * 24 * 60 * 60 * 1000);
  const payload = base64urlEncode(JSON.stringify({ sub: safeUserId, typ: safeType, exp: expiresAt }));
  return `${payload}.${signPayload(payload, env)}`;
}

export function verifyUnsubscribeToken(token, { env = process.env, now = () => Date.now() } = {}) {
  const [payload, signature, extra] = String(token || '').trim().split('.');
  if (!payload || !signature || extra) return { ok: false, error: 'invalid_unsubscribe_token' };
  const expected = signPayload(payload, env);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { ok: false, error: 'invalid_unsubscribe_token' };
  }

  let decoded = null;
  try {
    decoded = JSON.parse(base64urlDecode(payload));
  } catch {
    return { ok: false, error: 'invalid_unsubscribe_token' };
  }

  const userId = String(decoded?.sub || '').trim();
  const type = normalizeType(decoded?.typ);
  const expiresAt = Number(decoded?.exp || 0);
  if (!userId || !type || !Number.isFinite(expiresAt)) return { ok: false, error: 'invalid_unsubscribe_token' };
  if (expiresAt < Number(now())) return { ok: false, error: 'unsubscribe_token_expired' };
  return { ok: true, userId, type, expiresAt };
}

export function buildUnsubscribeUrl({ userId, type, baseUrl, env = process.env }) {
  const token = createUnsubscribeToken({ userId, type, env });
  if (!token) return '';
  const base = String(baseUrl || env.FRONTEND_ORIGIN || env.APP_URL || 'https://app.flightsuite.app').replace(/\/+$/, '');
  return `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
}
