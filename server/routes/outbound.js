import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { format, parseISO } from 'date-fns';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { buildOutboundReport, outboundReportToCsv } from '../lib/outbound-report.js';

const CABIN_ENUM = ['economy', 'premium', 'business'];
const CONNECTION_ENUM = ['all', 'direct', 'with_stops'];
const TRAVEL_TIME_ENUM = ['all', 'day', 'night'];
const OUTBOUND_SURFACE_ENUM = ['results', 'top_picks', 'compare', 'watchlist', 'insights', 'opportunity_detail'];

function buildPartnerSchema(allowedPartners) {
  const safePartners = Array.isArray(allowedPartners) ? allowedPartners.filter(Boolean) : [];
  return z.string().refine((value) => safePartners.includes(String(value || '')), {
    message: `Unsupported outbound partner. Allowed: ${safePartners.join(', ')}`
  });
}

const marketingTokenSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Marketing fields can only contain letters, numbers, dot, underscore and dash.');

function buildOutboundClickSchema(partnerSchema) {
  return z
    .object({
      eventName: z.enum(['booking_clicked']).default('booking_clicked'),
      correlationId: z.string().min(8).max(160).optional(),
      itineraryId: z.string().min(1).max(80).optional(),
      providerType: z.enum(['affiliate', 'white_label', 'direct']).optional(),
      partner: partnerSchema.optional(),
      url: z
        .string()
        .trim()
        .min(24)
        .max(2048)
        .refine((value) => /^\/api\/outbound\/resolve\?/i.test(value), 'Outbound click URL must be a /api/outbound/resolve link.'),
      surface: z.enum(OUTBOUND_SURFACE_ENUM).optional(),
      origin: z.string().min(3).max(3).optional(),
      destinationIata: z.string().min(3).max(3).optional(),
      destination: z.string().min(1).max(80).optional(),
      stopCount: z.number().int().min(0).max(2).optional(),
      comfortScore: z.number().int().min(1).max(100).optional(),
      connectionType: z.enum(CONNECTION_ENUM).optional(),
      travelTime: z.enum(TRAVEL_TIME_ENUM).optional(),
      utmSource: marketingTokenSchema.max(80).optional(),
      utmMedium: marketingTokenSchema.max(80).optional(),
      utmCampaign: marketingTokenSchema.max(120).optional()
    })
    .strict();
}

function buildOutboundResolveSchema(partnerSchema) {
  return z
    .object({
      partner: partnerSchema.default('tde_booking'),
      surface: z.enum(OUTBOUND_SURFACE_ENUM),
      correlationId: z.string().min(8).max(160).optional(),
      itineraryId: z.string().min(1).max(80).optional(),
      origin: z.string().min(3).max(3),
      destinationIata: z.string().min(3).max(3),
      destination: z.string().min(1).max(80).optional(),
      dateFrom: z.string(),
      dateTo: z.string().optional(),
      travellers: z.preprocess((value) => Number(value), z.number().int().min(1).max(9)).default(1),
      cabinClass: z.enum(CABIN_ENUM).default('economy'),
      stopCount: z.preprocess(
        (value) => {
          if (value === '' || value === undefined || value === null) return undefined;
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : undefined;
        },
        z.number().int().min(0).max(2).optional()
      ),
      comfortScore: z.preprocess(
        (value) => {
          if (value === '' || value === undefined || value === null) return undefined;
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : undefined;
        },
        z.number().int().min(1).max(100).optional()
      ),
      connectionType: z.enum(CONNECTION_ENUM).optional(),
      travelTime: z.enum(TRAVEL_TIME_ENUM).optional(),
      utmSource: marketingTokenSchema.max(80).optional(),
      utmMedium: marketingTokenSchema.max(80).optional(),
      utmCampaign: marketingTokenSchema.max(120).optional()
    })
    .strict()
    .superRefine((payload, ctx) => {
      const from = parseISO(payload.dateFrom);
      if (Number.isNaN(from.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid travel dates.' });
        return;
      }
      if (payload.dateTo) {
        const to = parseISO(payload.dateTo);
        if (Number.isNaN(to.getTime())) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid travel dates.' });
          return;
        }
        if (from.getTime() >= to.getTime()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'dateTo must be later than dateFrom.' });
        }
      }
    });
}

function parseOutboundResolvePayloadFromTrackingUrl(rawUrl, { outboundResolveSchema, outboundMaxQueryChars }) {
  const normalized = String(rawUrl || '').trim();
  if (!normalized || normalized.length > outboundMaxQueryChars) {
    throw new Error('Outbound tracking URL is missing or too large.');
  }
  let parsedUrl = null;
  try {
    parsedUrl = new URL(normalized, 'http://localhost');
  } catch {
    throw new Error('Outbound tracking URL is invalid.');
  }
  if (parsedUrl.pathname !== '/api/outbound/resolve') {
    throw new Error('Outbound tracking URL path is not allowed.');
  }
  const query = {};
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    query[key] = value;
  }
  const validated = outboundResolveSchema.safeParse(query);
  if (!validated.success) {
    throw new Error(validated.error.issues[0]?.message || 'Outbound tracking payload is invalid.');
  }
  return validated.data;
}

function findMatchingOutboundRedirectEntry(
  db,
  {
    payload
  }
) {
  const redirects = Array.isArray(db?.outboundRedirects) ? db.outboundRedirects : [];
  for (let index = redirects.length - 1; index >= 0; index -= 1) {
    const entry = redirects[index];
    if (!entry) continue;
    if (String(entry.partner || '') !== String(payload?.partner || '')) continue;
    if (String(entry.surface || '') !== String(payload?.surface || '')) continue;
    if (String(entry.origin || '') !== String(payload?.origin || '')) continue;
    if (String(entry.destinationIata || '') !== String(payload?.destinationIata || '')) continue;
    if (String(entry.correlationId || '') !== String(payload?.correlationId || '')) continue;
    if (String(entry.itineraryId || '') !== String(payload?.itineraryId || '')) continue;
    return entry;
  }
  return null;
}

function createOutboundClickToken({ clickId, targetUrl, expiresAt, outboundClickSecret }) {
  const payload = `${clickId}|${targetUrl}|${expiresAt}`;
  return createHmac('sha256', outboundClickSecret).update(payload).digest('hex');
}

function verifyOutboundClickToken({ clickId, targetUrl, expiresAt, clickToken, outboundClickSecret }) {
  const expected = createOutboundClickToken({ clickId, targetUrl, expiresAt, outboundClickSecret });
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(clickToken || ''), 'hex'));
  } catch {
    return false;
  }
}

function appendOutboundClick(db, payload) {
  db.outboundClicks = db.outboundClicks || [];
  db.outboundClicks.push({
    id: nanoid(10),
    at: new Date().toISOString(),
    ...payload
  });
  db.outboundClicks = db.outboundClicks.slice(-5000);
}

export function buildOutboundRouter({
  authGuard = (_req, _res, next) => next(),
  requireSessionAuth = (_req, _res, next) => next(),
  adminGuard = (_req, _res, next) => next(),
  requireApiScope = () => (_req, _res, next) => next(),
  quotaGuard = () => (_req, _res, next) => next(),
  optionalAuth = () => null,
  withDb,
  sendMachineError,
  resolveOutboundPartnerUrl,
  ensureAllowedOutboundUrl,
  allowedPartners = ['tde_booking'],
  outboundClickSecret,
  outboundClickTtlSeconds = 300,
  outboundMaxQueryChars = 1600
}) {
  const router = Router();
  const partnerSchema = buildPartnerSchema(allowedPartners);
  const outboundClickSchema = buildOutboundClickSchema(partnerSchema);
  const outboundResolveSchema = buildOutboundResolveSchema(partnerSchema);

  async function recordOutboundClickEvent(payload) {
    await withDb(async (db) => {
      appendOutboundClick(db, payload);
      return db;
    });
  }

  router.get('/api/outbound/resolve', async (req, res) => {
    const rawQueryLength = String(req.originalUrl || '').length;
    if (rawQueryLength > outboundMaxQueryChars) {
      return sendMachineError(req, res, 413, 'payload_too_large');
    }
    const parsed = outboundResolveSchema.safeParse(req.query);
    if (!parsed.success) {
      return sendMachineError(req, res, 400, 'invalid_payload', {
        message: parsed.error.issues[0]?.message ?? 'Controlla i dati inseriti e riprova.'
      });
    }

    const payload = parsed.data;
    let resolvedUrl;
    try {
      resolvedUrl = resolveOutboundPartnerUrl(payload);
    } catch (error) {
      return sendMachineError(req, res, 400, 'invalid_payload', { message: error?.message || 'Outbound URL non valida.' });
    }

    const clickId = nanoid(12);
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + outboundClickTtlSeconds * 1000).toISOString();
    const clickToken = createOutboundClickToken({ clickId, targetUrl: resolvedUrl, expiresAt, outboundClickSecret });
    const auth = optionalAuth(req);
    await withDb(async (db) => {
      db.outboundRedirects = db.outboundRedirects || [];
      db.outboundRedirects.push({
        id: clickId,
        clickId,
        issuedAt,
        expiresAt,
        clickToken,
        userId: auth?.sub || null,
        partner: payload.partner,
        url: resolvedUrl,
        surface: payload.surface,
        correlationId: payload.correlationId,
        itineraryId: payload.itineraryId,
        origin: payload.origin,
        destinationIata: payload.destinationIata,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo || null,
        travellers: payload.travellers,
        cabinClass: payload.cabinClass,
        destination: payload.destination || payload.destinationIata,
        stopCount: payload.stopCount,
        comfortScore: payload.comfortScore,
        connectionType: payload.connectionType,
        travelTime: payload.travelTime,
        utmSource: payload.utmSource,
        utmMedium: payload.utmMedium,
        utmCampaign: payload.utmCampaign
      });
      db.outboundRedirects = db.outboundRedirects
        .filter((entry) => new Date(entry.expiresAt).getTime() > Date.now())
        .slice(-10000);
      return db;
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, `/go/${clickId}`);
  });

  router.get('/go/:clickId', async (req, res) => {
    const clickId = String(req.params.clickId || '').trim();
    const auth = optionalAuth(req);
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(clickId)) {
      await recordOutboundClickEvent({
        eventName: 'outbound_redirect_failed',
        clickId,
        userId: auth?.sub || null,
        failureReason: 'invalid_click_id'
      });
      return sendMachineError(req, res, 400, 'invalid_payload', { message: 'Invalid link.' });
    }

    let redirectEntry = null;
    await withDb(async (db) => {
      db.outboundRedirects = (db.outboundRedirects || []).filter((entry) => new Date(entry.expiresAt).getTime() > Date.now());
      redirectEntry = db.outboundRedirects.find((entry) => entry.clickId === clickId) || null;
      if (!redirectEntry) return db;
      db.outboundRedirects = db.outboundRedirects.filter((entry) => entry.clickId !== clickId);
      return db;
    });

    const failureBase = {
      clickId,
      correlationId: redirectEntry?.correlationId,
      itineraryId: redirectEntry?.itineraryId,
      userId: redirectEntry?.userId || auth?.sub || null,
      partner: redirectEntry?.partner,
      surface: redirectEntry?.surface,
      origin: redirectEntry?.origin,
      destinationIata: redirectEntry?.destinationIata,
      destination: redirectEntry?.destination
    };

    if (!redirectEntry) {
      await recordOutboundClickEvent({
        eventName: 'outbound_redirect_failed',
        ...failureBase,
        failureReason: 'missing_redirect_entry'
      });
      return sendMachineError(req, res, 400, 'request_failed', { message: 'This link is no longer valid or has expired.' });
    }
    if (
      !verifyOutboundClickToken({
        clickId: redirectEntry.clickId,
        targetUrl: redirectEntry.url,
        expiresAt: redirectEntry.expiresAt,
        clickToken: redirectEntry.clickToken,
        outboundClickSecret
      })
    ) {
      await recordOutboundClickEvent({
        eventName: 'outbound_redirect_failed',
        ...failureBase,
        failureReason: 'invalid_click_token'
      });
      return sendMachineError(req, res, 400, 'request_failed', { message: 'Unable to verify the outbound link.' });
    }
    if (new Date(redirectEntry.expiresAt).getTime() <= Date.now()) {
      await recordOutboundClickEvent({
        eventName: 'outbound_redirect_failed',
        ...failureBase,
        failureReason: 'redirect_expired'
      });
      return sendMachineError(req, res, 400, 'request_failed', { message: 'This link has expired. Please try again from the search.' });
    }
    try {
      ensureAllowedOutboundUrl(redirectEntry.url);
    } catch {
      await recordOutboundClickEvent({
        eventName: 'outbound_redirect_failed',
        ...failureBase,
        failureReason: 'redirect_url_not_allowed'
      });
      return sendMachineError(req, res, 400, 'request_failed', { message: 'Partner destination not allowed.' });
    }

    await recordOutboundClickEvent({
      eventName: 'outbound_redirect_succeeded',
      providerType: 'affiliate',
      clickId: redirectEntry.clickId,
      correlationId: redirectEntry.correlationId,
      itineraryId: redirectEntry.itineraryId,
      userId: redirectEntry.userId || auth?.sub || null,
      partner: redirectEntry.partner,
      url: redirectEntry.url,
      surface: redirectEntry.surface,
      origin: redirectEntry.origin,
      destinationIata: redirectEntry.destinationIata,
      destination: redirectEntry.destination,
      stopCount: redirectEntry.stopCount,
      comfortScore: redirectEntry.comfortScore,
      connectionType: redirectEntry.connectionType,
      travelTime: redirectEntry.travelTime,
      utmSource: redirectEntry.utmSource,
      utmMedium: redirectEntry.utmMedium,
      utmCampaign: redirectEntry.utmCampaign
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, redirectEntry.url);
  });

  router.post('/api/outbound/click', async (req, res) => {
    const parsed = outboundClickSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendMachineError(req, res, 400, 'invalid_payload', {
        message: parsed.error.issues[0]?.message ?? 'Invalid outbound payload.'
      });
    }

    const auth = optionalAuth(req);
    const payload = parsed.data;
    let resolvePayload = null;
    let resolvedUrl = '';
    try {
      resolvePayload = parseOutboundResolvePayloadFromTrackingUrl(payload.url, { outboundResolveSchema, outboundMaxQueryChars });
      resolvedUrl = resolveOutboundPartnerUrl(resolvePayload);
      ensureAllowedOutboundUrl(resolvedUrl);
    } catch (error) {
      return sendMachineError(req, res, 400, 'invalid_payload', {
        message: error?.message || 'Invalid outbound payload.'
      });
    }

    let matchedRedirect = null;
    let deduped = false;
    await withDb(async (db) => {
      db.outboundRedirects = (db.outboundRedirects || []).filter((entry) => new Date(entry.expiresAt).getTime() > Date.now());
      matchedRedirect = findMatchingOutboundRedirectEntry(db, {
        payload: resolvePayload
      });
      if (!matchedRedirect) return db;

      db.outboundClicks = Array.isArray(db.outboundClicks) ? db.outboundClicks : [];
      deduped = db.outboundClicks.some(
        (event) => String(event?.eventName || '') === 'booking_clicked' && String(event?.clickId || '') === String(matchedRedirect.clickId || '')
      );
      if (!deduped) {
        appendOutboundClick(db, {
          eventName: 'booking_clicked',
          providerType: matchedRedirect.providerType || 'affiliate',
          clickId: matchedRedirect.clickId,
          clickToken: matchedRedirect.clickToken,
          userId: matchedRedirect.userId || null,
          correlationId: matchedRedirect.correlationId || null,
          itineraryId: matchedRedirect.itineraryId || null,
          partner: matchedRedirect.partner,
          url: matchedRedirect.url,
          surface: matchedRedirect.surface,
          origin: matchedRedirect.origin,
          destinationIata: matchedRedirect.destinationIata,
          destination: matchedRedirect.destination,
          stopCount: matchedRedirect.stopCount,
          comfortScore: matchedRedirect.comfortScore,
          connectionType: matchedRedirect.connectionType,
          travelTime: matchedRedirect.travelTime,
          utmSource: matchedRedirect.utmSource,
          utmMedium: matchedRedirect.utmMedium,
          utmCampaign: matchedRedirect.utmCampaign,
          trustLevel: 'server_bound_redirect'
        });
      }
      return db;
    });

    if (!matchedRedirect) {
      return sendMachineError(req, res, 403, 'request_forbidden', {
        message: 'Missing server-issued outbound redirect context.'
      });
    }

    if (deduped) return res.status(202).json({ ok: true, deduped: true });
    return res.status(201).json({ ok: true, deduped: false });
  });

  router.get(
    '/api/outbound/report',
    authGuard,
    requireSessionAuth,
    adminGuard,
    requireApiScope('read'),
    quotaGuard({ counter: 'read', amount: 1 }),
    async (_req, res) => {
      let report = null;
      await withDb(async (db) => {
        report = buildOutboundReport(db, 30);
        return null;
      });
      return res.json(report);
    }
  );

  router.get(
    '/api/outbound/report.csv',
    authGuard,
    requireSessionAuth,
    adminGuard,
    requireApiScope('export'),
    quotaGuard({ counter: 'export', amount: 1 }),
    async (_req, res) => {
      let report = null;
      await withDb(async (db) => {
        report = buildOutboundReport(db, 30);
        return null;
      });
      const csv = outboundReportToCsv(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="outbound-report-${format(new Date(), 'yyyyMMdd-HHmm')}.csv"`);
      return res.status(200).send(csv);
    }
  );

  return router;
}
