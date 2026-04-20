import { Router } from 'express';
import { z } from 'zod';
import { canUseRadar, canUseSmartAlerts, getUpgradeContext, resolveUserPlan } from '../lib/plan-access.js';

// Pro users get a limited number of active price alerts per month.
const SMART_ALERTS_PRO_LIMIT = Number(process.env.SMART_ALERTS_PRO_LIMIT ?? 3);
import { getPriceAlertsStore } from '../lib/price-alerts-store.js';

const iataSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Invalid IATA code.');
const isoDateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Expected YYYY-MM-DD.');
const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Invalid currency. Expected ISO code.');

const channelsSchema = z
  .object({
    push: z.boolean().optional(),
    email: z.boolean().optional(),
    in_app: z.boolean().optional(),
    inApp: z.boolean().optional()
  })
  .strict();

const priceAlertCreateSchema = z
  .object({
    originIata: iataSchema,
    destinationIata: iataSchema,
    dateFrom: isoDateSchema,
    dateTo: isoDateSchema,
    maxPrice: z.coerce.number().positive('Invalid maxPrice. Expected a positive number.'),
    currency: currencySchema.optional(),
    enabled: z.boolean().optional(),
    channels: channelsSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.dateTo < value.dateFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateTo'],
        message: 'dateTo must be greater than or equal to dateFrom.'
      });
    }
    if (value.originIata === value.destinationIata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destinationIata'],
        message: 'destinationIata must be different from originIata.'
      });
    }
    const channels = value.channels || {};
    const inApp = channels.in_app ?? channels.inApp;
    if (channels.push === false && channels.email === false && inApp === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['channels'],
        message: 'At least one notification channel must be enabled.'
      });
    }
  });

const priceAlertUpdateSchema = z
  .object({
    originIata: iataSchema.optional(),
    destinationIata: iataSchema.optional(),
    dateFrom: isoDateSchema.optional(),
    dateTo: isoDateSchema.optional(),
    maxPrice: z.coerce.number().positive('Invalid maxPrice. Expected a positive number.').optional(),
    currency: currencySchema.optional(),
    enabled: z.boolean().optional(),
    channels: channelsSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field is required for update.'
      });
    }
    if (value.dateFrom && value.dateTo && value.dateTo < value.dateFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateTo'],
        message: 'dateTo must be greater than or equal to dateFrom.'
      });
    }
    if (value.originIata && value.destinationIata && value.originIata === value.destinationIata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destinationIata'],
        message: 'destinationIata must be different from originIata.'
      });
    }
    const channels = value.channels || null;
    if (channels) {
      const inApp = channels.in_app ?? channels.inApp;
      if (channels.push === false && channels.email === false && inApp === false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['channels'],
          message: 'At least one notification channel must be enabled.'
        });
      }
    }
  });

export function buildAlertsRouter({
  authGuard,
  csrfGuard,
  requireApiScope,
  quotaGuard,
  withDb,
  nanoid,
  scanSubscriptionsOnce,
  watchlistSchema,
  alertSubscriptionSchema,
  alertSubscriptionUpdateSchema,
  fetchCurrentUser,
  sendMachineError,
  priceAlertsStore = getPriceAlertsStore(),
  scanPriceAlertsOnce = async () => ({ skipped: true, reason: 'price_alert_worker_not_configured' })
}) {
  const router = Router();
  const sendInvalidPayload = (req, res, message) => {
    if (typeof sendMachineError === 'function') {
      return sendMachineError(req, res, 400, 'invalid_payload', { message });
    }
    return res.status(400).json({ error: message || 'Invalid payload.' });
  };
  const sendServerError = (req, res, message = 'Unable to process request right now.') => {
    if (typeof sendMachineError === 'function') {
      return sendMachineError(req, res, 500, 'request_failed', { message });
    }
    return res.status(500).json({ error: message });
  };

  router.get('/watchlist', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
    let items = [];
    await withDb(async (db) => {
      items = db.watchlists.filter((w) => w.userId === req.user.sub);
      return null;
    });
    return res.json({ items });
  });

  router.post('/watchlist', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    const parsed = watchlistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

    const item = {
      id: nanoid(10),
      userId: req.user.sub,
      createdAt: new Date().toISOString(),
      ...parsed.data
    };

    await withDb(async (db) => {
      const duplicate = db.watchlists.find(
        (w) => w.userId === req.user.sub && w.flightId === item.flightId && w.dateFrom === item.dateFrom && w.dateTo === item.dateTo
      );
      if (!duplicate) db.watchlists.push(item);

      const existingTracker = db.alertSubscriptions.find(
        (s) =>
          s.userId === req.user.sub &&
          s.origin === item.flightId.split('-')[0] &&
          s.destinationIata === item.destinationIata &&
          s.enabled
      );

      if (!existingTracker) {
        const fromDate = new Date(item.dateFrom);
        const stayDaysRaw = Math.round((new Date(item.dateTo) - fromDate) / (24 * 3600 * 1000));
        const daysFromNowRaw = Math.round((fromDate - new Date()) / (24 * 3600 * 1000));

        db.alertSubscriptions.push({
          id: nanoid(10),
          userId: req.user.sub,
          createdAt: new Date().toISOString(),
          enabled: true,
          origin: item.flightId.split('-')[0],
          region: 'all',
          country: undefined,
          destinationQuery: item.destination,
          destinationIata: item.destinationIata,
          targetPrice: Math.max(35, Math.floor(item.price * 0.95)),
          cheapOnly: false,
          travellers: 1,
          cabinClass: 'economy',
          connectionType: 'all',
          maxStops: 2,
          travelTime: 'all',
          minComfortScore: undefined,
          stayDays: Math.min(30, Math.max(2, Number.isFinite(stayDaysRaw) ? stayDaysRaw : 7)),
          daysFromNow: Math.min(180, Math.max(1, Number.isFinite(daysFromNowRaw) ? daysFromNowRaw : 14))
        });
      }
      return db;
    });

    await scanSubscriptionsOnce();
    return res.status(201).json({ item });
  });

  router.delete('/watchlist/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    let removed = false;
    await withDb(async (db) => {
      const before = db.watchlists.length;
      db.watchlists = db.watchlists.filter((w) => !(w.id === req.params.id && w.userId === req.user.sub));
      removed = db.watchlists.length !== before;
      return db;
    });

    if (!removed) return res.status(404).json({ error: 'Item not found.' });
    return res.status(204).send();
  });

  router.get('/alerts/subscriptions', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
    let items = [];
    await withDb(async (db) => {
      items = db.alertSubscriptions.filter((s) => s.userId === req.user.sub);
      return null;
    });
    return res.json({ items });
  });

  router.post('/alerts/subscriptions', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    const parsed = alertSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid subscription payload.' });
    const isDurationMode = !Number.isFinite(parsed.data.targetPrice);
    if (isDurationMode) {
      const user = await fetchCurrentUser(req.user.sub);
      if (!user) return sendMachineError(req, res, 404, 'user_not_found');
      if (!canUseRadar(user)) return sendMachineError(req, res, 402, 'premium_required');
    }

    const subscription = {
      id: nanoid(10),
      userId: req.user.sub,
      createdAt: new Date().toISOString(),
      enabled: true,
      ...parsed.data,
      destinationIata: parsed.data.destinationIata?.toUpperCase(),
      scanMode: Number.isFinite(parsed.data.targetPrice) ? 'price_target' : 'duration_auto'
    };

    await withDb(async (db) => {
      db.alertSubscriptions.push(subscription);
      return db;
    });

    await scanSubscriptionsOnce();
    return res.status(201).json({ item: subscription });
  });

  router.delete('/alerts/subscriptions/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    let removed = false;
    await withDb(async (db) => {
      const before = db.alertSubscriptions.length;
      db.alertSubscriptions = db.alertSubscriptions.filter((s) => !(s.id === req.params.id && s.userId === req.user.sub));
      removed = db.alertSubscriptions.length !== before;
      return db;
    });

    if (!removed) return res.status(404).json({ error: 'Subscription not found.' });
    return res.status(204).send();
  });

  router.patch('/alerts/subscriptions/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    const parsed = alertSubscriptionUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid subscription update payload.' });

    let updatedItem = null;
    await withDb(async (db) => {
      const hit = db.alertSubscriptions.find((s) => s.id === req.params.id && s.userId === req.user.sub);
      if (!hit) return db;

      if (Object.hasOwn(parsed.data, 'enabled')) hit.enabled = parsed.data.enabled;
      if (Object.hasOwn(parsed.data, 'targetPrice')) hit.targetPrice = parsed.data.targetPrice ?? undefined;
      if (Object.hasOwn(parsed.data, 'connectionType')) hit.connectionType = parsed.data.connectionType;
      if (Object.hasOwn(parsed.data, 'maxStops')) hit.maxStops = parsed.data.maxStops ?? undefined;
      if (Object.hasOwn(parsed.data, 'travelTime')) hit.travelTime = parsed.data.travelTime;
      if (Object.hasOwn(parsed.data, 'minComfortScore')) hit.minComfortScore = parsed.data.minComfortScore ?? undefined;
      if (Object.hasOwn(parsed.data, 'cheapOnly')) hit.cheapOnly = parsed.data.cheapOnly;
      if (Object.hasOwn(parsed.data, 'travellers')) hit.travellers = parsed.data.travellers;
      if (Object.hasOwn(parsed.data, 'cabinClass')) hit.cabinClass = parsed.data.cabinClass;
      if (Object.hasOwn(parsed.data, 'stayDays')) hit.stayDays = parsed.data.stayDays;
      if (Object.hasOwn(parsed.data, 'daysFromNow')) hit.daysFromNow = parsed.data.daysFromNow ?? undefined;

      hit.scanMode = Number.isFinite(hit.targetPrice) ? 'price_target' : 'duration_auto';
      updatedItem = { ...hit };
      return db;
    });

    if (!updatedItem) return res.status(404).json({ error: 'Subscription not found.' });
    await scanSubscriptionsOnce();
    return res.json({ item: updatedItem });
  });

  router.get('/alerts/price-alerts', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
    try {
      const items = await priceAlertsStore.listPriceAlerts({ userId: req.user.sub });
      return res.json({ items });
    } catch (error) {
      return sendServerError(req, res, error?.message || 'Failed to list price alerts.');
    }
  });

  router.post('/alerts/price-alerts', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    const parsed = priceAlertCreateSchema.safeParse(req.body);
    if (!parsed.success) return sendInvalidPayload(req, res, parsed.error.issues[0]?.message ?? 'Invalid price alert payload.');

    const user = await fetchCurrentUser(req.user.sub);
    if (!user) return sendMachineError(req, res, 404, 'user_not_found');
    const { planType } = resolveUserPlan(user);

    if (planType === 'free') {
      // Free users cannot create price alerts at all.
      return res.status(402).json({
        error: 'premium_required',
        message: 'Price alerts are available on the Pro and Elite plans.',
        upgrade_context: getUpgradeContext(user, 'smart_alerts'),
        pro_limit: SMART_ALERTS_PRO_LIMIT,
        request_id: req.id || null
      });
    }

    if (planType === 'pro') {
      // Pro users are capped at SMART_ALERTS_PRO_LIMIT active price alerts.
      try {
        const existing = await priceAlertsStore.listPriceAlerts({ userId: req.user.sub });
        const activeCount = (Array.isArray(existing) ? existing : []).filter((a) => !a.deletedAt && a.enabled !== false).length;
        if (activeCount >= SMART_ALERTS_PRO_LIMIT) {
          return res.status(402).json({
            error: 'premium_required',
            message: `Pro plan allows up to ${SMART_ALERTS_PRO_LIMIT} active price alerts. Upgrade to Elite for unlimited alerts.`,
            upgrade_context: 'smart_alerts_limit',
            alerts_used: activeCount,
            alerts_limit: SMART_ALERTS_PRO_LIMIT,
            request_id: req.id || null
          });
        }
      } catch {
        // Count check failed — allow the request rather than blocking unfairly.
      }
    }
    // Elite: unlimited — no additional check needed.

    try {
      const item = await priceAlertsStore.createPriceAlert({
        userId: req.user.sub,
        originIata: parsed.data.originIata,
        destinationIata: parsed.data.destinationIata,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
        maxPrice: parsed.data.maxPrice,
        currency: parsed.data.currency || 'EUR',
        channels: parsed.data.channels || undefined,
        enabled: parsed.data.enabled
      });
      try {
        await scanPriceAlertsOnce({ limit: 250, reason: 'alert_created' });
      } catch {}
      return res.status(201).json({ item });
    } catch (error) {
      if (error?.message?.toLowerCase().includes('invalid')) return sendInvalidPayload(req, res, error.message);
      return sendServerError(req, res, error?.message || 'Failed to create price alert.');
    }
  });

  router.post('/alerts/price-alerts/scan', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'notifications', amount: 1 }), async (req, res) => {
    try {
      const result = await scanPriceAlertsOnce({ reason: 'manual' });
      return res.json({ ok: true, result });
    } catch (error) {
      return sendServerError(req, res, error?.message || 'Failed to scan price alerts.');
    }
  });

  router.patch('/alerts/price-alerts/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    const parsed = priceAlertUpdateSchema.safeParse(req.body);
    if (!parsed.success) return sendInvalidPayload(req, res, parsed.error.issues[0]?.message ?? 'Invalid price alert update payload.');

    try {
      const item = await priceAlertsStore.updatePriceAlert({
        userId: req.user.sub,
        alertId: req.params.id,
        patch: parsed.data
      });
      if (!item) return res.status(404).json({ error: 'Price alert not found.' });
      return res.json({ item });
    } catch (error) {
      if (error?.message?.toLowerCase().includes('invalid')) return sendInvalidPayload(req, res, error.message);
      return sendServerError(req, res, error?.message || 'Failed to update price alert.');
    }
  });

  router.delete('/alerts/price-alerts/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    try {
      const outcome = await priceAlertsStore.deletePriceAlert({ userId: req.user.sub, alertId: req.params.id });
      if (!outcome.removed) return res.status(404).json({ error: 'Price alert not found.' });
      return res.status(204).send();
    } catch (error) {
      return sendServerError(req, res, error?.message || 'Failed to delete price alert.');
    }
  });

  router.get('/notifications', authGuard, requireApiScope('read'), quotaGuard({ counter: 'notifications', amount: 1 }), async (req, res) => {
    let items = [];
    await withDb(async (db) => {
      items = db.notifications
        .filter((n) => n.userId === req.user.sub)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 100);
      return null;
    });

    const unread = items.filter((n) => !n.readAt).length;
    return res.json({ items, unread });
  });

  router.post('/notifications/:id/read', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'notifications', amount: 1 }), async (req, res) => {
    let updated = false;
    await withDb(async (db) => {
      const hit = db.notifications.find((n) => n.id === req.params.id && n.userId === req.user.sub);
      if (hit && !hit.readAt) {
        hit.readAt = new Date().toISOString();
        updated = true;
      }
      return db;
    });

    if (!updated) return res.status(404).json({ error: 'Notification not found.' });
    return res.status(204).send();
  });

  router.post('/notifications/read-all', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'notifications', amount: 1 }), async (req, res) => {
    await withDb(async (db) => {
      for (const n of db.notifications) {
        if (n.userId === req.user.sub && !n.readAt) n.readAt = new Date().toISOString();
      }
      return db;
    });
    return res.status(204).send();
  });

  router.post('/notifications/scan', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'notifications', amount: 1 }), async (_req, res) => {
    await scanSubscriptionsOnce();
    return res.json({ ok: true });
  });

  return router;
}
