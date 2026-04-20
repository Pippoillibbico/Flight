import express from 'express';
import { nanoid } from 'nanoid';

function sanitizeTelemetryText(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, Math.max(1, Number(maxLength) || 120));
}

function resolveTelemetryAt(clientAt, allowedSkewMs) {
  const nowMs = Date.now();
  const parsedMs = new Date(clientAt || '').getTime();
  if (!Number.isFinite(parsedMs)) return new Date(nowMs).toISOString();
  if (Math.abs(parsedMs - nowMs) > allowedSkewMs) return new Date(nowMs).toISOString();
  return new Date(parsedMs).toISOString();
}

function buildTelemetryFingerprint(payload, userId) {
  const base = [
    String(userId || ''),
    String(payload.eventType || ''),
    String(payload.action || ''),
    String(payload.surface || ''),
    String(payload.source || ''),
    String(payload.routeSlug || ''),
    String(payload.dealId || ''),
    String(payload.sessionId || ''),
    String(payload.price || ''),
    String(payload.planType || ''),
    String(payload.correlationId || ''),
    String(payload.itineraryId || '')
  ].join('|');
  return payload.createHash('sha256').update(base).digest('hex').slice(0, 48);
}

export function buildAdminTelemetryRouter({
  telemetryBurstLimiter,
  telemetryEventLimiter,
  authGuard,
  requireSessionAuth,
  csrfGuard,
  safeJsonByteLength,
  sendMachineError,
  adminTelemetryEventSchema,
  withDb,
  fetchCurrentUser,
  resolveUserPlan,
  logger,
  createHash,
  ADMIN_TELEMETRY_MAX_BODY_BYTES,
  ADMIN_TELEMETRY_ALLOWED_SKEW_MS,
  ADMIN_TELEMETRY_DEDUPE_WINDOW_MS,
  TELEMETRY_BURST_WINDOW_MS,
  TELEMETRY_BURST_MAX,
  toIsoFromRateLimit
}) {
  const router = express.Router();

  router.post(
    '/api/admin/telemetry',
    telemetryBurstLimiter,
    telemetryEventLimiter,
    authGuard,
    requireSessionAuth,
    csrfGuard,
    async (req, res) => {
      const rawBody = req.body;
      if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
        return sendMachineError(req, res, 400, 'invalid_payload');
      }
      const bodySize = safeJsonByteLength(rawBody);
      if (!Number.isFinite(bodySize) || bodySize > ADMIN_TELEMETRY_MAX_BODY_BYTES) {
        return sendMachineError(req, res, 413, 'payload_too_large');
      }

      const parsed = adminTelemetryEventSchema.safeParse(rawBody);
      if (!parsed.success) return sendMachineError(req, res, 400, 'invalid_payload');

      const payload = parsed.data;
      const userId = String(req.user?.sub || req.user?.id || '').trim() || null;
      const telemetryUser = userId ? await fetchCurrentUser(userId) : null;
      const resolvedPlanType = telemetryUser ? resolveUserPlan(telemetryUser).planType : null;
      if (payload.planType && resolvedPlanType && payload.planType !== resolvedPlanType) {
        logger.warn(
          {
            request_id: req.id || null,
            user_id: userId,
            claimed_plan_type: payload.planType,
            resolved_plan_type: resolvedPlanType
          },
          'admin_telemetry_plan_type_overridden'
        );
      }
      const derivedFingerprint = buildTelemetryFingerprint(
        {
          ...payload,
          planType: resolvedPlanType || null,
          createHash
        },
        userId || 'anonymous'
      );
      const eventRecord = {
        id: nanoid(10),
        at: resolveTelemetryAt(payload.at, ADMIN_TELEMETRY_ALLOWED_SKEW_MS),
        userId,
        email: null,
        eventId: derivedFingerprint,
        fingerprint: derivedFingerprint,
        eventVersion: 1,
        schemaVersion: 2,
        sourceContext: 'web_app',
        eventType: payload.eventType,
        action: sanitizeTelemetryText(payload.action, 80) || null,
        surface: sanitizeTelemetryText(payload.surface, 80) || null,
        itineraryId: sanitizeTelemetryText(payload.itineraryId, 120) || null,
        correlationId: sanitizeTelemetryText(payload.correlationId, 180) || null,
        source: sanitizeTelemetryText(payload.source, 120) || null,
        routeSlug: sanitizeTelemetryText(payload.routeSlug, 120) || null,
        dealId: sanitizeTelemetryText(payload.dealId, 120) || null,
        sessionId: sanitizeTelemetryText(payload.sessionId, 120) || null,
        price: Number.isFinite(Number(payload.price)) ? Number(payload.price) : null,
        planType: resolvedPlanType || null,
        trustLevel: 'session_bound_client'
      };
      logger.info(
        {
          eventType: eventRecord.eventType,
          dealId: eventRecord.dealId,
          sessionId: eventRecord.sessionId,
          userId: eventRecord.userId
        },
        'admin_telemetry_event_received'
      );

      let rejectedForBurst = false;
      let burstResetAt = null;
      await withDb(async (db) => {
        db.clientTelemetryEvents = Array.isArray(db.clientTelemetryEvents) ? db.clientTelemetryEvents : [];
        const eventAtMs = new Date(eventRecord.at).getTime();
        const recentSameFingerprintCount = db.clientTelemetryEvents.reduce((count, candidate) => {
          if (!candidate || typeof candidate !== 'object') return count;
          if (String(candidate.userId || '') !== String(eventRecord.userId || '')) return count;
          if (String(candidate.fingerprint || '') !== String(eventRecord.fingerprint || '')) return count;
          const candidateAt = new Date(candidate.at || '').getTime();
          if (!Number.isFinite(candidateAt) || !Number.isFinite(eventAtMs)) return count;
          if (Math.abs(eventAtMs - candidateAt) > TELEMETRY_BURST_WINDOW_MS) return count;
          return count + 1;
        }, 0);
        if (recentSameFingerprintCount >= TELEMETRY_BURST_MAX) {
          rejectedForBurst = true;
          burstResetAt = new Date(eventAtMs + TELEMETRY_BURST_WINDOW_MS).toISOString();
          return db;
        }

        const hasDuplicate = db.clientTelemetryEvents.some((candidate) => {
          if (!candidate || typeof candidate !== 'object') return false;
          if (String(candidate.userId || '') !== String(eventRecord.userId || '')) return false;
          if (eventRecord.eventId && String(candidate.eventId || '') === String(eventRecord.eventId || '')) return true;
          if (eventRecord.fingerprint && String(candidate.fingerprint || '') === String(eventRecord.fingerprint || '')) return true;
          if (String(candidate.eventType || '') !== String(eventRecord.eventType || '')) return false;
          if (String(candidate.action || '') !== String(eventRecord.action || '')) return false;
          if (String(candidate.surface || '') !== String(eventRecord.surface || '')) return false;
          if (String(candidate.source || '') !== String(eventRecord.source || '')) return false;
          if (String(candidate.planType || '') !== String(eventRecord.planType || '')) return false;
          if (String(candidate.routeSlug || '') !== String(eventRecord.routeSlug || '')) return false;
          if (String(candidate.dealId || '') !== String(eventRecord.dealId || '')) return false;
          if (String(candidate.sessionId || '') !== String(eventRecord.sessionId || '')) return false;
          if (String(candidate.price || '') !== String(eventRecord.price || '')) return false;
          if (String(candidate.correlationId || '') !== String(eventRecord.correlationId || '')) return false;
          if (String(candidate.itineraryId || '') !== String(eventRecord.itineraryId || '')) return false;
          const candidateAt = new Date(candidate.at || '').getTime();
          if (!Number.isFinite(candidateAt) || !Number.isFinite(eventAtMs)) return false;
          return Math.abs(eventAtMs - candidateAt) <= ADMIN_TELEMETRY_DEDUPE_WINDOW_MS;
        });
        if (hasDuplicate) return db;
        db.clientTelemetryEvents.push(eventRecord);
        db.clientTelemetryEvents = db.clientTelemetryEvents.slice(-12000);
        return db;
      });
      if (rejectedForBurst) {
        return sendMachineError(req, res, 429, 'rate_limited', { reset_at: burstResetAt || toIsoFromRateLimit(req) });
      }

      return res.status(201).json({ ok: true });
    }
  );

  return router;
}
