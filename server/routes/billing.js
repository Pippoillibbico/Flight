import express from 'express';
import { getOrCreateSubscription, upsertSubscriptionFromStripe } from '../lib/saas-db.js';
import { readDb, withDb } from '../lib/db.js';
import { appendImmutableAudit } from '../lib/audit-log.js';
import { setUserPlan } from '../lib/gating/index.js';
import { claimStripeWebhookEvent, finalizeStripeWebhookEvent } from '../lib/stripe-webhook-event-store.js';
import { logger } from '../lib/logger.js';
import {
  BILLING_PROVIDER,
  cancelPayloadSchema,
  changePlanPayloadSchema,
  checkoutPayloadSchema,
  portalPayloadSchema,
  resumePayloadSchema,
  StripeBillingService,
  StripeBillingStateService,
  StripeBillingWebhookService
} from '../lib/billing/index.js';

function createDefaultSetUserPlan() {
  return async ({ userId, planType, status = 'active' }) => {
    await withDb((db) => {
      const mutableUser = (db.users || []).find((entry) => entry.id === userId);
      if (!mutableUser) return db;
      setUserPlan(mutableUser, planType === 'elite' ? 'elite' : planType === 'pro' ? 'pro' : 'free');
      mutableUser.planStatus = status;
      mutableUser.updatedAt = new Date().toISOString();
      return db;
    });
  };
}

function buildBillingService(deps = {}) {
  if (deps.billingService) return deps.billingService;

  const stateService =
    deps.stateService ||
    new StripeBillingStateService({
      readDb: deps.readDb || readDb,
      withDb: deps.withDb || withDb,
      getOrCreateSubscription: deps.getOrCreateSubscription || getOrCreateSubscription,
      upsertSubscriptionFromProvider: deps.upsertSubscriptionFromProvider || upsertSubscriptionFromStripe,
      appendImmutableAudit: deps.appendImmutableAudit || appendImmutableAudit,
      setUserPlan: deps.setUserPlan || createDefaultSetUserPlan(),
      logger: deps.logger || logger
    });

  if (deps.getUserById) stateService.getUserById = deps.getUserById;
  if (deps.ensureStripeCustomerForUser) stateService.ensureStripeCustomerForUser = deps.ensureStripeCustomerForUser;

  const webhookService =
    deps.webhookService ||
    new StripeBillingWebhookService({
      billingProvider: BILLING_PROVIDER,
      stateService,
      claimStripeWebhookEvent: deps.claimStripeWebhookEvent || claimStripeWebhookEvent,
      finalizeStripeWebhookEvent: deps.finalizeStripeWebhookEvent || finalizeStripeWebhookEvent,
      logger: deps.logger || logger
    });

  if (deps.parseStripeWebhookEvent) webhookService.parseStripeWebhookEvent = deps.parseStripeWebhookEvent;
  if (deps.handleStripeEvent) webhookService.handleStripeEvent = deps.handleStripeEvent;

  const billingService =
    deps.stripeBillingService ||
    new StripeBillingService({
      stateService,
      webhookService,
      logger: deps.logger || logger
    });

  if (deps.isStripeConfigured) billingService.isStripeConfigured = deps.isStripeConfigured;
  if (deps.getStripeClient) billingService.getStripeClient = deps.getStripeClient;

  return billingService;
}

function sendServiceResult(res, result) {
  const status = Number(result?.status || 200);
  return res.status(status).json(result?.body || {});
}

export function buildBillingRouter({ authGuard, requireSessionAuth = (_req, _res, next) => next(), csrfGuard }, deps = {}) {
  const router = express.Router();
  const billingService = buildBillingService(deps);

  router.post('/webhook', async (req, res) => billingService.handleWebhook(req, res));

  router.get('/public-config', (_req, res) => {
    const result = billingService.getPublicConfig();
    return sendServiceResult(res, result);
  });

  router.get('/subscription', authGuard, requireSessionAuth, async (req, res, next) => {
    try {
      const data = await billingService.getSubscription(req.user.id || req.user.sub);
      return res.json({ ...data, billingProvider: BILLING_PROVIDER });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/subscription/sync', authGuard, requireSessionAuth, csrfGuard, async (req, res, next) => {
    try {
      const result = await billingService.syncSubscription(req.user?.id || req.user?.sub);
      return sendServiceResult(res, result);
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/billing/subscription/sync' }, 'billing_subscription_sync_error');
      return next(error);
    }
  });

  router.post('/subscription/change-plan', authGuard, requireSessionAuth, csrfGuard, async (req, res, next) => {
    try {
      const parsed = changePlanPayloadSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid plan-change payload.' });
      }

      const result = await billingService.changePlan(req.user?.id || req.user?.sub, parsed.data);
      return sendServiceResult(res, result);
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/billing/subscription/change-plan' }, 'billing_change_plan_error');
      return next(error);
    }
  });

  router.post('/subscription/cancel', authGuard, requireSessionAuth, csrfGuard, async (req, res, next) => {
    try {
      const parsed = cancelPayloadSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid cancellation payload.' });
      }

      const result = await billingService.cancelSubscription(req.user?.id || req.user?.sub, parsed.data);
      return sendServiceResult(res, result);
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/billing/subscription/cancel' }, 'billing_cancel_subscription_error');
      return next(error);
    }
  });

  router.post('/subscription/resume', authGuard, requireSessionAuth, csrfGuard, async (req, res, next) => {
    try {
      const parsed = resumePayloadSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid resume payload.' });
      }

      const result = await billingService.resumeSubscription(req.user?.id || req.user?.sub, parsed.data);
      return sendServiceResult(res, result);
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/billing/subscription/resume' }, 'billing_resume_subscription_error');
      return next(error);
    }
  });

  router.get('/client-token', authGuard, requireSessionAuth, (_req, res) => {
    return res.status(410).json({
      error: 'endpoint_removed',
      message: 'Braintree client-token flow has been removed. Use /api/billing/checkout for Stripe.'
    });
  });

  router.post('/checkout', authGuard, requireSessionAuth, csrfGuard, async (req, res, next) => {
    try {
      const parsed = checkoutPayloadSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid checkout payload.' });
      }

      const result = await billingService.createCheckout(req.user?.id || req.user?.sub, parsed.data);
      return sendServiceResult(res, result);
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/billing/checkout' }, 'billing_checkout_error');
      return next(error);
    }
  });

  router.post('/portal', authGuard, requireSessionAuth, csrfGuard, async (req, res, next) => {
    try {
      const parsed = portalPayloadSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid portal payload.' });
      }

      const result = await billingService.createPortal(req.user?.id || req.user?.sub, parsed.data);
      return sendServiceResult(res, result);
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/billing/portal' }, 'billing_portal_error');
      return next(error);
    }
  });

  return router;
}
