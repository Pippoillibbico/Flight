import express from 'express';
import { z } from 'zod';
import { runDiscoveryJustGo } from '../lib/discovery-engine.js';
import { findCheapestDestinations, findPriceDrops, findUnderratedRoutes } from '../lib/destination-discovery-engine.js';
import { createDiscoverySubscription, deleteDiscoverySubscription, listDiscoverySubscriptions } from '../lib/deal-engine-store.js';

const MOODS = ['relax', 'adventure', 'culture', 'nature', 'nightlife'];
const REGIONS = ['all', 'eu', 'asia', 'america', 'oceania'];

const discoverySchema = z.object({
  origin: z.string().trim().length(3),
  budget: z.number().positive(),
  mood: z.enum(MOODS).default('relax'),
  region: z.enum(REGIONS).default('all'),
  dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const discoverySubSchema = z.object({
  origin: z.string().trim().length(3),
  budget: z.number().positive(),
  mood: z.enum(MOODS).default('relax'),
  region: z.enum(REGIONS).default('all'),
  dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  enabled: z.boolean().optional().default(true)
});

const smartOriginSchema = z.object({
  origin: z.string().trim().length(3),
  limit: z.coerce.number().int().min(1).max(50).optional().default(12)
});

const smartCheapestSchema = z.object({
  origin: z.string().trim().length(3),
  month: z.string().trim().regex(/^\d{4}-\d{2}$/),
  limit: z.coerce.number().int().min(1).max(50).optional().default(12)
});

export function buildDiscoveryRouter({ authGuard, csrfGuard, quotaGuard, requireApiScope }) {
  const router = express.Router();

  router.post('/just-go', authGuard, csrfGuard, requireApiScope('search'), quotaGuard({ counter: 'decision', amount: 1 }), async (req, res, next) => {
    const parsed = discoverySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const userId = req.user?.sub || req.user?.id;
      const result = await runDiscoveryJustGo({ userId, ...parsed.data });
      return res.json(result);
    } catch (error) {
      const message = String(error?.message || '');
      if (message.toLowerCase().startsWith('invalid')) return res.status(400).json({ error: message });
      next(error);
    }
  });

  router.get('/smart/cheapest', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res, next) => {
    const parsed = smartCheapestSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const items = await findCheapestDestinations(parsed.data.origin, parsed.data.month, parsed.data.limit);
      return res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get('/smart/underrated', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res, next) => {
    const parsed = smartOriginSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const items = await findUnderratedRoutes(parsed.data.origin, parsed.data.limit);
      return res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get('/smart/price-drops', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res, next) => {
    const parsed = smartOriginSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const items = await findPriceDrops(parsed.data.origin, parsed.data.limit);
      return res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get('/subscriptions', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res, next) => {
    try {
      const userId = req.user?.sub || req.user?.id;
      const items = await listDiscoverySubscriptions(userId);
      return res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.post('/subscriptions', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res, next) => {
    const parsed = discoverySubSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const userId = req.user?.sub || req.user?.id;
      const item = await createDiscoverySubscription({
        userId,
        originIata: parsed.data.origin,
        budgetEur: parsed.data.budget,
        mood: parsed.data.mood,
        region: parsed.data.region,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
        enabled: parsed.data.enabled
      });
      return res.status(201).json({ item });
    } catch (error) {
      const message = String(error?.message || '');
      if (message.toLowerCase().startsWith('invalid')) return res.status(400).json({ error: message });
      next(error);
    }
  });

  router.delete('/subscriptions/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res, next) => {
    try {
      const userId = req.user?.sub || req.user?.id;
      const ok = await deleteDiscoverySubscription({ userId, subscriptionId: req.params.id });
      if (!ok) return res.status(404).json({ error: 'Subscription not found.' });
      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
