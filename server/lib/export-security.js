import { createHash } from 'node:crypto';
import { z } from 'zod';
import { anonymizeIpForLogs, hashValueForLogs } from './log-redaction.js';

const EXPORT_REASON_PREFIX_ALLOWLIST = ['support', 'billing', 'debug', 'compliance', 'security'];

const exportReasonSchema = z
  .string()
  .trim()
  .min(10, 'Export reason required')
  .max(200, 'Export reason too long')
  .regex(/^[a-z0-9_:/. -]+$/i, 'Export reason contains unsupported characters');

function sanitizeExportReason(rawReason) {
  return String(rawReason || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAllowedReasonPrefix(reason) {
  const normalized = String(reason || '').toLowerCase();
  return EXPORT_REASON_PREFIX_ALLOWLIST.some((prefix) => normalized.startsWith(`${prefix}_`) || normalized.startsWith(`${prefix}:`));
}

export function requireExportReason(options = {}) {
  const enforcePrefix = options.enforcePrefix === true;
  return (req, res, next) => {
    const sanitizedReason = sanitizeExportReason(req.headers['x-export-reason']);
    const parsed = exportReasonSchema.safeParse(sanitizedReason);
    if (!parsed.success) return res.status(400).json({ error: 'Export reason required' });
    if (enforcePrefix && !isAllowedReasonPrefix(parsed.data)) {
      return res.status(400).json({ error: 'Export reason required' });
    }
    req.exportReason = parsed.data;
    return next();
  };
}

export function requireExportPagination(req, res, next) {
  const schema = z.object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(1000).default(200)
  });
  const parsed = schema.safeParse(req.query || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  req.exportPagination = parsed.data;
  return next();
}

export function createExportRateLimiter({ windowMs = 60_000, max = 10 } = {}) {
  const store = new Map();
  const safeWindowMs = Math.max(10_000, Number(windowMs) || 60_000);
  const safeMax = Math.max(1, Number(max) || 10);
  return (req, res, next) => {
    const actor = String(req.user?.sub || req.user?.id || req.ip || 'anonymous').trim();
    const bucket = Math.floor(Date.now() / safeWindowMs);
    const key = `${actor}:${bucket}`;
    const hits = Number(store.get(key) || 0) + 1;
    store.set(key, hits);
    if (hits > safeMax) return res.status(429).json({ error: 'rate_limited' });
    return next();
  };
}

function hashActorId(rawActorId) {
  const actor = String(rawActorId || '').trim();
  if (!actor) return null;
  return `usr_${hashValueForLogs(actor, { label: 'actor', length: 24 })}`;
}

function hashUserAgent(ua) {
  const rawUa = String(ua || '').trim();
  if (!rawUa) return null;
  return hashValueForLogs(rawUa, { label: 'ua', length: 24 }) || null;
}

export function buildExportAuditEvent(req, { action, targetType, targetId, outcome = 'success' } = {}) {
  const actorId = hashActorId(req.user?.sub || req.user?.id || null);
  const correlationId = String(req.id || '').trim() || null;
  const reason = String(req.exportReason || '').trim() || null;
  const userAgentHash = hashUserAgent(req.headers['user-agent']);
  const ipHash = anonymizeIpForLogs(req.ip || req.socket?.remoteAddress || '');
  const actionLabel = String(action || 'export').trim() || 'export';
  return {
    actorId,
    action: actionLabel,
    reason,
    targetType: String(targetType || 'export').trim(),
    targetId: String(targetId || createHash('sha256').update(`${actionLabel}:${correlationId || Date.now()}`).digest('hex').slice(0, 20)).trim(),
    timestamp: new Date().toISOString(),
    ipHash,
    userAgentHash,
    correlationId,
    outcome
  };
}
