/**
 * routes/billing.js
 *
 * Billing integration with provider switch:
 * - stripe (default)
 * - braintree
 */

import express from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import braintree from 'braintree';
import { getOrCreateSubscription, upsertSubscriptionFromStripe } from '../lib/saas-db.js';
import { readDb, withDb } from '../lib/db.js';
import { appendImmutableAudit } from '../lib/audit-log.js';
import { setUserPlan } from '../lib/plan-access.js';
import { logger } from '../lib/logger.js';

const BILLING_PROVIDER = String(process.env.BILLING_PROVIDER || 'stripe').trim().toLowerCase();
let cachedBraintreeGateway = null;
const checkoutPayloadSchema = z.object({
  planType: z.enum(['pro', 'elite']),
  paymentMethodNonce: z.string().trim().min(8),
  deviceData: z.string().trim().optional()
});

function planFromStripePrice(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_PRO]: 'pro',
    [process.env.STRIPE_PRICE_CREATOR]: 'creator'
  };
  return map[priceId] ?? 'free';
}

function planFromBraintreePlan(planId) {
  const map = {
    [process.env.BT_PLAN_PRO_ID]: 'pro',
    [process.env.BT_PLAN_CREATOR_ID]: 'creator'
  };
  return map[planId] ?? 'free';
}

function planToBraintreePlanId(planType) {
  const normalized = String(planType || '').trim().toLowerCase();
  if (normalized === 'pro') return String(process.env.BT_PLAN_PRO_ID || '').trim();
  if (normalized === 'elite' || normalized === 'creator') return String(process.env.BT_PLAN_CREATOR_ID || '').trim();
  return '';
}

function getBraintreeEnvironment(raw) {
  const env = String(raw || '').trim().toLowerCase();
  if (env === 'production') return braintree.Environment.Production;
  if (env === 'sandbox') return braintree.Environment.Sandbox;
  return null;
}

function isBraintreeConfigured() {
  return Boolean(
    String(process.env.BT_MERCHANT_ID || '').trim() &&
      String(process.env.BT_PUBLIC_KEY || '').trim() &&
      String(process.env.BT_PRIVATE_KEY || '').trim() &&
      getBraintreeEnvironment(process.env.BT_ENVIRONMENT)
  );
}

function getBraintreeGateway() {
  if (cachedBraintreeGateway) return cachedBraintreeGateway;
  const environment = getBraintreeEnvironment(process.env.BT_ENVIRONMENT);
  if (!environment) throw new Error('Invalid BT_ENVIRONMENT');
  cachedBraintreeGateway = new braintree.BraintreeGateway({
    environment,
    merchantId: String(process.env.BT_MERCHANT_ID || '').trim(),
    publicKey: String(process.env.BT_PUBLIC_KEY || '').trim(),
    privateKey: String(process.env.BT_PRIVATE_KEY || '').trim()
  });
  return cachedBraintreeGateway;
}

function normalizeSubscriptionStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (status === 'active') return 'active';
  if (status === 'canceled' || status === 'cancelled') return 'canceled';
  if (status === 'expired') return 'canceled';
  if (status === 'past due') return 'past_due';
  return status || 'active';
}

function makeBraintreeEventId(payload) {
  const digest = createHash('sha256').update(String(payload || '')).digest('hex');
  return `bt_${digest.slice(0, 48)}`;
}

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

    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

    return signatures.some((sig) => {
      try {
        return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

async function claimBillingEvent({ id, type }) {
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

async function finalizeBillingEvent({ id, status }) {
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

async function resolveUserIdFromStripeCustomer(stripeCustomerId) {
  if (!stripeCustomerId) return null;
  try {
    const db = await readDb();
    const user = db.users?.find((u) => u.stripeCustomerId === stripeCustomerId);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

async function resolveUserIdFromBraintreeCustomer(customerId) {
  if (!customerId) return null;
  try {
    const db = await readDb();
    const user = db.users?.find((u) => u.braintreeCustomerId === customerId || u.braintreeCustomerId === `bt_${customerId}`);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

async function getUserById(userId) {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) return null;
  try {
    const db = await readDb();
    return (db.users || []).find((entry) => entry.id === safeUserId) || null;
  } catch {
    return null;
  }
}

async function setUserBraintreeCustomerId({ userId, customerId }) {
  const safeUserId = String(userId || '').trim();
  const safeCustomerId = String(customerId || '').trim();
  if (!safeUserId || !safeCustomerId) return;
  await withDb((db) => {
    const user = (db.users || []).find((entry) => entry.id === safeUserId);
    if (!user) return db;
    user.braintreeCustomerId = safeCustomerId;
    user.updatedAt = new Date().toISOString();
    return db;
  });
}

function toIsoOrNow(raw) {
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

async function ensureBraintreeCustomerForUser({ gateway, user }) {
  const existing = String(user?.braintreeCustomerId || '').trim();
  if (existing) return existing;

  const customerRes = await gateway.customer.create({
    email: String(user?.email || '').trim() || undefined,
    firstName: String(user?.name || '').trim().slice(0, 60) || undefined
  });
  if (!customerRes?.success || !customerRes?.customer?.id) {
    const message = customerRes?.message || 'Unable to create billing customer.';
    throw Object.assign(new Error(message), { code: 'billing_customer_create_failed', details: customerRes?.errors || null });
  }
  const customerId = String(customerRes.customer.id);
  await setUserBraintreeCustomerId({ userId: user.id, customerId });
  return customerId;
}

async function handleStripeEvent(event) {
  const { type, data } = event;

  switch (type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = data.object;
      const userId = sub.metadata?.user_id ?? (await resolveUserIdFromStripeCustomer(sub.customer));
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
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false
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
      const userId = sub.metadata?.user_id ?? (await resolveUserIdFromStripeCustomer(sub.customer));
      if (!userId) return;

      await upsertSubscriptionFromStripe({
        userId,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: sub.customer,
        planId: 'free',
        status: 'canceled',
        currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: false
      });
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = data.object;
      const userId = await resolveUserIdFromStripeCustomer(invoice.customer);
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
      logger.info({ stripe_event_type: type }, 'stripe_webhook_event_ignored');
      break;
  }
}

async function handleBraintreeNotification(notification) {
  const kind = String(notification?.kind || '');
  const subscription = notification?.subscription || null;
  if (!subscription?.id) {
    logger.warn({ braintree_kind: kind }, 'braintree_webhook_subscription_missing');
    return;
  }

  const customerId =
    subscription?.transactions?.[0]?.customerDetails?.id ||
    subscription?.transactions?.[0]?.customer?.id ||
    subscription?.transactions?.[0]?.customerId ||
    null;

  const userId = await resolveUserIdFromBraintreeCustomer(customerId);
  if (!userId) {
    logger.warn({ braintree_subscription_id: subscription.id, braintree_kind: kind }, 'braintree_subscription_user_missing');
    return;
  }

  const status = normalizeSubscriptionStatus(subscription.status);
  const planId = planFromBraintreePlan(subscription.planId);
  const isCanceledKind = [
    braintree.WebhookNotification.Kind.SubscriptionCanceled,
    braintree.WebhookNotification.Kind.SubscriptionExpired
  ].includes(kind);

  await upsertSubscriptionFromStripe({
    userId,
    stripeSubscriptionId: `bt_${subscription.id}`,
    stripeCustomerId: customerId ? `bt_${customerId}` : null,
    planId,
    status: isCanceledKind ? 'canceled' : status,
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: null,
    cancelAtPeriodEnd: isCanceledKind
  });

  await appendImmutableAudit({
    actor: 'braintree',
    action: 'billing.subscription.updated',
    target: userId,
    metadata: {
      subscriptionId: subscription.id,
      planId,
      status: isCanceledKind ? 'canceled' : status,
      kind
    }
  }).catch(() => {});
}

export function buildBillingRouter({ authGuard, csrfGuard }, deps = {}) {
  const router = express.Router();
  const billingProvider = String(deps.billingProvider || BILLING_PROVIDER).trim().toLowerCase();
  const isBraintreeConfiguredSafe = deps.isBraintreeConfigured || isBraintreeConfigured;
  const getBraintreeGatewaySafe = deps.getBraintreeGateway || getBraintreeGateway;
  const getUserByIdSafe = deps.getUserById || getUserById;
  const ensureBraintreeCustomerForUserSafe = deps.ensureBraintreeCustomerForUser || ensureBraintreeCustomerForUser;
  const upsertSubscriptionSafe = deps.upsertSubscriptionFromProvider || upsertSubscriptionFromStripe;
  const appendImmutableAuditSafe = deps.appendImmutableAudit || appendImmutableAudit;
  const getOrCreateSubscriptionSafe = deps.getOrCreateSubscription || getOrCreateSubscription;
  const setUserPlanSafe =
    deps.setUserPlan ||
    (async ({ userId, planType, status = 'active' }) => {
      await withDb((db) => {
        const mutableUser = (db.users || []).find((entry) => entry.id === userId);
        if (!mutableUser) return db;
        setUserPlan(mutableUser, planType === 'elite' ? 'elite' : 'pro');
        mutableUser.planStatus = status === 'active' ? 'active' : mutableUser.planStatus || 'active';
        mutableUser.updatedAt = new Date().toISOString();
        return db;
      });
    });

  router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
    if (billingProvider === 'braintree') {
      if (!isBraintreeConfiguredSafe()) {
        logger.warn({ endpoint: '/api/billing/webhook' }, 'braintree_webhook_config_missing');
        if (process.env.NODE_ENV === 'production') {
          return res.status(503).json({ error: 'billing_not_configured' });
        }
        return res.json({ received: true });
      }

      const signature = String(req.body?.bt_signature || '').trim();
      const payload = String(req.body?.bt_payload || '').trim();
      if (!signature || !payload) {
        logger.warn({ endpoint: '/api/billing/webhook' }, 'braintree_webhook_missing_payload');
        return res.status(400).json({ error: 'Malformed webhook payload.' });
      }

      let notification = null;
      try {
        const gateway = getBraintreeGatewaySafe();
        notification = await gateway.webhookNotification.parse(signature, payload);
      } catch (error) {
        logger.warn({ endpoint: '/api/billing/webhook', err: error?.message || String(error) }, 'braintree_webhook_signature_invalid');
        return res.status(400).json({ error: 'Invalid Braintree signature.' });
      }

      const eventId = makeBraintreeEventId(payload);
      const alreadyProcessed = await claimBillingEvent({
        id: eventId,
        type: `braintree.${String(notification?.kind || 'unknown')}`
      });
      if (alreadyProcessed) {
        logger.info({ billing_provider: 'braintree', billing_event_id: eventId, braintree_kind: notification?.kind }, 'billing_webhook_deduped');
        return res.json({ received: true, deduped: true });
      }

      try {
        await handleBraintreeNotification(notification);
        await finalizeBillingEvent({ id: eventId, status: 'processed' });
        logger.info({ billing_provider: 'braintree', billing_event_id: eventId, braintree_kind: notification?.kind }, 'billing_webhook_processed');
      } catch (error) {
        await finalizeBillingEvent({ id: eventId, status: 'failed' });
        logger.error({ err: error, endpoint: '/api/billing/webhook', billing_provider: 'braintree', braintree_kind: notification?.kind }, 'billing_webhook_handler_error');
      }

      return res.json({ received: true });
    }

    const sig = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      logger.warn({ endpoint: '/api/billing/webhook' }, 'stripe_webhook_secret_missing');
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'billing_not_configured' });
      }
      return res.json({ received: true });
    }

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
      const alreadyProcessed = await claimBillingEvent({
        id: eventId,
        type: String(event?.type || 'unknown')
      });
      if (alreadyProcessed) {
        logger.info({ billing_provider: 'stripe', billing_event_id: eventId, stripe_event_type: event?.type }, 'billing_webhook_deduped');
        return res.json({ received: true, deduped: true });
      }
      await handleStripeEvent(event);
      await finalizeBillingEvent({ id: eventId, status: 'processed' });
      logger.info({ billing_provider: 'stripe', billing_event_id: eventId, stripe_event_type: event?.type }, 'billing_webhook_processed');
    } catch (error) {
      const eventId = String(event?.id || '').trim();
      if (eventId) await finalizeBillingEvent({ id: eventId, status: 'failed' });
      logger.error({ err: error, endpoint: '/api/billing/webhook', stripe_event_type: event?.type, billing_provider: 'stripe' }, 'billing_webhook_handler_error');
    }

    return res.json({ received: true });
  });

  router.get('/subscription', authGuard, async (req, res, next) => {
    try {
      const sub = await getOrCreateSubscriptionSafe(req.user.id || req.user.sub);
      return res.json({
        planId: sub.plan_id ?? sub.planId ?? 'free',
        status: sub.status ?? 'active',
        currentPeriodEnd: sub.current_period_end ?? sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? sub.cancelAtPeriodEnd ?? false,
        extraCredits: sub.extra_credits ?? sub.extraCredits ?? 0,
        billingProvider
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/client-token', authGuard, async (req, res, next) => {
    try {
      if (billingProvider !== 'braintree') {
        return res.status(400).json({ error: 'billing_provider_not_supported', message: 'Client token endpoint is available only with Braintree.' });
      }
      if (!isBraintreeConfiguredSafe()) {
        return res.status(503).json({ error: 'billing_not_configured', message: 'Braintree credentials are not configured.' });
      }
      const userId = req.user?.id || req.user?.sub;
      const user = await getUserByIdSafe(userId);
      if (!user) return res.status(404).json({ error: 'user_not_found' });
      const gateway = getBraintreeGatewaySafe();
      const customerId = await ensureBraintreeCustomerForUserSafe({ gateway, user });
      const tokenRes = await gateway.clientToken.generate({ customerId });
      if (!tokenRes?.clientToken) {
        return res.status(502).json({ error: 'billing_token_error', message: 'Unable to generate checkout token.' });
      }
      return res.json({ provider: 'braintree', clientToken: tokenRes.clientToken });
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/billing/client-token' }, 'billing_client_token_error');
      return next(error);
    }
  });

  router.post('/checkout', authGuard, csrfGuard, async (req, res, next) => {
    try {
      if (billingProvider !== 'braintree') {
        return res.status(400).json({ error: 'billing_provider_not_supported', message: 'Checkout endpoint requires Braintree provider.' });
      }
      if (!isBraintreeConfiguredSafe()) {
        return res.status(503).json({ error: 'billing_not_configured', message: 'Braintree credentials are not configured.' });
      }

      const parsed = checkoutPayloadSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid checkout payload.' });

      const userId = req.user?.id || req.user?.sub;
      const user = await getUserByIdSafe(userId);
      if (!user) return res.status(404).json({ error: 'user_not_found' });

      const braintreePlanId = planToBraintreePlanId(parsed.data.planType);
      if (!braintreePlanId) {
        return res.status(500).json({ error: 'billing_plan_not_configured', message: `Missing Braintree plan mapping for ${parsed.data.planType}.` });
      }

      const gateway = getBraintreeGatewaySafe();
      const customerId = await ensureBraintreeCustomerForUserSafe({ gateway, user });

      const paymentMethodResult = await gateway.paymentMethod.create({
        customerId,
        paymentMethodNonce: parsed.data.paymentMethodNonce,
        options: {
          makeDefault: true,
          verifyCard: true
        }
      });
      if (!paymentMethodResult?.success || !paymentMethodResult?.paymentMethod?.token) {
        const message = paymentMethodResult?.message || 'Payment method could not be verified.';
        return res.status(402).json({ error: 'payment_method_failed', message });
      }

      const subscriptionResult = await gateway.subscription.create({
        paymentMethodToken: paymentMethodResult.paymentMethod.token,
        planId: braintreePlanId
      });
      if (!subscriptionResult?.success || !subscriptionResult?.subscription?.id) {
        const message = subscriptionResult?.message || 'Subscription creation failed.';
        return res.status(402).json({ error: 'subscription_failed', message });
      }

      const subscription = subscriptionResult.subscription;
      const planId = parsed.data.planType === 'elite' ? 'creator' : 'pro';
      const status = normalizeSubscriptionStatus(subscription.status);
      const currentPeriodStart = toIsoOrNow(subscription.billingPeriodStartDate);
      const currentPeriodEnd = subscription.billingPeriodEndDate ? toIsoOrNow(subscription.billingPeriodEndDate) : null;

      await upsertSubscriptionSafe({
        userId: user.id,
        stripeSubscriptionId: `bt_${subscription.id}`,
        stripeCustomerId: `bt_${customerId}`,
        planId,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: false
      });

      await setUserPlanSafe({
        userId: user.id,
        planType: parsed.data.planType,
        status
      });

      await appendImmutableAuditSafe({
        actor: 'billing_checkout',
        action: 'billing.subscription.created',
        target: user.id,
        metadata: {
          provider: 'braintree',
          subscriptionId: subscription.id,
          customerId,
          status,
          planType: parsed.data.planType
        }
      }).catch(() => {});

      return res.status(201).json({
        ok: true,
        provider: 'braintree',
        planType: parsed.data.planType,
        subscription: {
          id: subscription.id,
          status,
          currentPeriodStart,
          currentPeriodEnd
        }
      });
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/billing/checkout' }, 'billing_checkout_error');
      return next(error);
    }
  });

  router.post('/portal', authGuard, async (_req, res) => {
    if (billingProvider === 'braintree') {
      return res.status(501).json({
        error: 'not_implemented',
        message: 'Configure Braintree customer portal/self-service flow to enable billing management.'
      });
    }
    return res.status(501).json({
      error: 'not_implemented',
      message: 'Set STRIPE_SECRET_KEY and configure Stripe customer portal to enable billing management.'
    });
  });

  return router;
}
