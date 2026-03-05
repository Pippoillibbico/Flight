/**
 * routes/billing.js
 *
 * Stripe billing integration.
 *
 * POST /api/billing/webhook     — Stripe webhook (raw body required, no auth)
 * GET  /api/billing/subscription — current user's subscription
 * POST /api/billing/portal      — create Stripe customer portal session (stub)
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_PRO          (Stripe price ID for Pro plan)
 *   STRIPE_PRICE_CREATOR      (Stripe price ID for Creator plan)
 */

import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getOrCreateSubscription, upsertSubscriptionFromStripe } from '../lib/saas-db.js';
import { readDb, withDb } from '../lib/db.js';
import { appendImmutableAudit } from '../lib/audit-log.js';
import { logger } from '../lib/logger.js';

// Map Stripe price IDs → internal plan IDs
function planFromStripePrice(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_PRO]:     'pro',
    [process.env.STRIPE_PRICE_CREATOR]: 'creator'
  };
  return map[priceId] ?? 'free';
}

/**
 * Verify Stripe webhook signature.
 * Returns true if valid, false otherwise.
 */
function verifyStripeSignature(rawBody, signatureHeader, secret) {
  try {
    const parts = signatureHeader.split(',').reduce((acc, part) => {
      const [k, v] = part.split('=');
      acc[k] = v;
      return acc;
    }, {});

    const timestamp = parts.t;
    const signatures = signatureHeader.match(/v1=([a-f0-9]+)/g)?.map((s) => s.slice(3)) ?? [];
    const payload = `${timestamp}.${rawBody}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');

    // Replay attack prevention: reject events older than 5 minutes
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

    return signatures.some((sig) => {
      try {
        return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
      } catch { return false; }
    });
  } catch { return false; }
}

export function buildBillingRouter({ authGuard }) {
  const router = Router();

  // ── Stripe Webhook ───────────────────────────────────────────────
  // NOTE: This route needs raw body — mount it before express.json() middleware
  // or use express.raw() on this specific path. In server/index.js we pass
  // rawBodyParser as a route-level middleware.
  router.post(
    '/webhook',
    (req, res, next) => {
      // If body was already parsed as JSON, reconstruct raw string for verification
      // Proper setup: use express.raw({ type: 'application/json' }) for this route
      next();
    },
    async (req, res) => {
      const sig = req.headers['stripe-signature'];
      const secret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!secret) {
        logger.warn({ endpoint: '/api/billing/webhook' }, 'stripe_webhook_secret_missing');
        return res.json({ received: true });
      }

      // Raw body must be available as req.rawBody (set by express.raw middleware)
      const rawBody = req.rawBody ?? JSON.stringify(req.body);

      if (!verifyStripeSignature(rawBody, sig ?? '', secret)) {
        logger.warn({ endpoint: '/api/billing/webhook' }, 'stripe_webhook_signature_invalid');
        return res.status(400).json({ error: 'Invalid Stripe signature.' });
      }

      let event;
      try {
        event = JSON.parse(rawBody);
      } catch {
        logger.warn({ endpoint: '/api/billing/webhook' }, 'stripe_webhook_malformed_json');
        return res.status(400).json({ error: 'Malformed JSON.' });
      }

      try {
        const eventId = String(event?.id || '').trim();
        if (!eventId) {
          logger.warn({ endpoint: '/api/billing/webhook' }, 'stripe_webhook_missing_event_id');
          return res.json({ received: true, deduped: false });
        }
        const alreadyProcessed = await claimStripeEvent({
          id: eventId,
          type: String(event?.type || 'unknown')
        });
        if (alreadyProcessed) {
          logger.info({ stripe_event_id: eventId, stripe_event_type: event?.type }, 'stripe_webhook_deduped');
          return res.json({ received: true, deduped: true });
        }
        await handleStripeEvent(event);
        await finalizeStripeEvent({ id: eventId, status: 'processed' });
        logger.info({ stripe_event_id: eventId, stripe_event_type: event?.type }, 'stripe_webhook_processed');
      } catch (err) {
        const eventId = String(event?.id || '').trim();
        if (eventId) await finalizeStripeEvent({ id: eventId, status: 'failed' });
        logger.error({ err, endpoint: '/api/billing/webhook', stripe_event_type: event?.type }, 'stripe_webhook_handler_error');
        // Return 200 so Stripe does not retry for application errors
      }

      return res.json({ received: true });
    }
  );

  // ── Current subscription ─────────────────────────────────────────
  router.get('/subscription', authGuard, async (req, res, next) => {
    try {
      const sub = await getOrCreateSubscription(req.user.id || req.user.sub);
      return res.json({
        planId: sub.plan_id ?? sub.planId ?? 'free',
        status: sub.status ?? 'active',
        currentPeriodEnd: sub.current_period_end ?? sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? sub.cancelAtPeriodEnd ?? false,
        extraCredits: sub.extra_credits ?? sub.extraCredits ?? 0
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Customer portal (stub — requires Stripe SDK in production) ───
  router.post('/portal', authGuard, async (req, res) => {
    return res.status(501).json({
      error: 'not_implemented',
      message: 'Set STRIPE_SECRET_KEY and configure the Stripe customer portal to enable billing management.'
    });
  });

  return router;
}

// ── Event handlers ────────────────────────────────────────────────

async function handleStripeEvent(event) {
  const { type, data } = event;

  switch (type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = data.object;
      const userId = sub.metadata?.user_id ?? await resolveUserIdFromCustomer(sub.customer);
      if (!userId) {
        logger.warn({ stripe_subscription_id: sub.id, stripe_event_type: type }, 'stripe_subscription_user_missing');
        return;
      }

      const priceId = sub.items?.data?.[0]?.price?.id;
      await upsertSubscriptionFromStripe({
        userId,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: sub.customer,
        planId: planFromStripePrice(priceId),
        status: sub.status,
        currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
        currentPeriodEnd:   new Date(sub.current_period_end   * 1000).toISOString(),
        cancelAtPeriodEnd:  sub.cancel_at_period_end ?? false
      });

      await appendImmutableAudit({
        actor: 'stripe',
        action: `billing.subscription.${type === 'customer.subscription.created' ? 'created' : 'updated'}`,
        target: userId,
        metadata: { subscriptionId: sub.id, status: sub.status, planId: planFromStripePrice(priceId) }
      }).catch(() => {});
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = data.object;
      const userId = sub.metadata?.user_id ?? await resolveUserIdFromCustomer(sub.customer);
      if (!userId) return;

      await upsertSubscriptionFromStripe({
        userId,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: sub.customer,
        planId: 'free',
        status: 'canceled',
        currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
        currentPeriodEnd:   new Date(sub.current_period_end   * 1000).toISOString(),
        cancelAtPeriodEnd: false
      });
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = data.object;
      const userId = await resolveUserIdFromCustomer(invoice.customer);
      if (userId) {
        await appendImmutableAudit({
          actor: 'stripe',
          action: 'billing.payment_failed',
          target: userId,
          metadata: { invoiceId: invoice.id, amount: invoice.amount_due }
        }).catch(() => {});
      }
      break;
    }

    default:
      // Unhandled events are ignored gracefully
      logger.info({ stripe_event_type: type }, 'stripe_webhook_event_ignored');
      break;
  }
}

async function claimStripeEvent({ id, type }) {
  let alreadyProcessed = false;
  await withDb((db) => {
    db.stripeWebhookEvents = db.stripeWebhookEvents || [];
    const existing = db.stripeWebhookEvents.find((item) => item.id === id);
    alreadyProcessed = Boolean(existing && existing.status === 'processed');
    if (!existing) {
      db.stripeWebhookEvents.push({
        id,
        type,
        status: 'processing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      db.stripeWebhookEvents = db.stripeWebhookEvents.slice(-10000);
    } else if (existing.status !== 'processed') {
      existing.status = 'processing';
      existing.updatedAt = new Date().toISOString();
    }
    return db;
  });
  return alreadyProcessed;
}

async function finalizeStripeEvent({ id, status }) {
  await withDb((db) => {
    db.stripeWebhookEvents = db.stripeWebhookEvents || [];
    for (const entry of db.stripeWebhookEvents) {
      if (entry.id !== id) continue;
      entry.status = status;
      entry.updatedAt = new Date().toISOString();
      if (status === 'processed') entry.processedAt = entry.updatedAt;
      break;
    }
    return db;
  });
}

async function resolveUserIdFromCustomer(stripeCustomerId) {
  if (!stripeCustomerId) return null;
  try {
    const db = await readDb();
    const user = db.users?.find((u) => u.stripeCustomerId === stripeCustomerId);
    return user?.id ?? null;
  } catch { return null; }
}
