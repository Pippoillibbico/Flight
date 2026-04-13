/**
 * VAPID Web Push routes.
 *
 * GET  /api/push/vapid-public-key   — public, returns VAPID public key for PushManager.subscribe()
 * POST /api/push/subscribe          — auth required, saves a browser PushSubscription
 * DELETE /api/push/subscribe        — auth required, removes a browser PushSubscription
 * GET  /api/push/subscriptions      — auth required, lists user's registered devices
 */
import { Router } from 'express';
import { z } from 'zod';
import { getVapidPublicKey, isVapidConfigured } from '../lib/vapid-sender.js';
import {
  upsertPushSubscription,
  removePushSubscription,
  listPushSubscriptionsForUser
} from '../lib/push-subscriptions-store.js';

const SubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(10),
    auth:   z.string().min(4)
  })
});

export function buildPushRouter({
  authGuard   = (_req, _res, next) => next(),
  csrfGuard   = (_req, _res, next) => next()
} = {}) {
  const router = Router();

  // Public — frontend needs this to call PushManager.subscribe()
  router.get('/vapid-public-key', (_req, res) => {
    const key = getVapidPublicKey();
    if (!key) return res.status(503).json({ error: 'vapid_not_configured' });
    res.json({ publicKey: key });
  });

  // Save a browser PushSubscription
  router.post('/subscribe', authGuard, csrfGuard, async (req, res) => {
    if (!isVapidConfigured()) {
      return res.status(503).json({ error: 'vapid_not_configured' });
    }
    const parse = SubscriptionSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'invalid_subscription', detail: parse.error.issues });
    }
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });

    const record = await upsertPushSubscription({ userId, subscription: parse.data });
    return res.status(201).json({ ok: true, id: record.id });
  });

  // Remove a browser PushSubscription
  router.delete('/subscribe', authGuard, csrfGuard, async (req, res) => {
    const endpoint = String(req.body?.endpoint || '').trim();
    if (!endpoint) return res.status(400).json({ error: 'endpoint_required' });
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });
    const removed = await removePushSubscription({ userId, endpoint });
    return res.json({ ok: true, removed });
  });

  // List subscriptions for the current user
  router.get('/subscriptions', authGuard, async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthenticated' });
    const subs = await listPushSubscriptionsForUser(userId);
    return res.json({
      subscriptions: subs.map((s) => ({
        id: s.id,
        endpoint: s.endpoint,
        createdAt: s.createdAt
      }))
    });
  });

  return router;
}
