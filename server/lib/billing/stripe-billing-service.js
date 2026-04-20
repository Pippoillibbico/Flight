import Stripe from 'stripe';
import { BILLING_PROVIDER } from './stripe-billing-schemas.js';
import { logEconomicEvent } from '../economic-logger.js';
import { normalizeStripeProrationBehavior, resolveAbsoluteUrl } from './stripe-billing-utils.js';

const STRIPE_API_VERSION = '2026-02-25.clover';
const STRIPE_CHECKOUT_FEE_RATE = 0.029;
const STRIPE_CHECKOUT_FEE_FIXED_EUR = 0.3;

function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function estimateStripeFeeForCheckout(revenueEur) {
  const revenue = Number(revenueEur);
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  return round4(revenue * STRIPE_CHECKOUT_FEE_RATE + STRIPE_CHECKOUT_FEE_FIXED_EUR);
}

function resolveConfiguredPlanPriceEur(planType) {
  const normalized = String(planType || '').trim().toLowerCase();
  if (normalized === 'pro') {
    const envValue = Number(process.env.PRICING_PRO_EUR);
    if (Number.isFinite(envValue) && envValue > 0) return round4(envValue);
    return 12.99;
  }
  if (normalized === 'creator' || normalized === 'elite') {
    const envValue = Number(process.env.PRICING_CREATOR_EUR);
    if (Number.isFinite(envValue) && envValue > 0) return round4(envValue);
    return 29.99;
  }
  return null;
}

export class StripeBillingService {
  constructor({ stateService, webhookService, logger }) {
    this.stateService = stateService;
    this.webhookService = webhookService;
    this.logger = logger;
    this.cachedStripeClient = null;
  }

  isStripeConfigured() {
    return String(process.env.STRIPE_SECRET_KEY || '').trim().length >= 16;
  }

  getStripeClient() {
    if (this.cachedStripeClient) return this.cachedStripeClient;
    const apiKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
    if (!apiKey) throw new Error('Missing STRIPE_SECRET_KEY');
    this.cachedStripeClient = new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION });
    return this.cachedStripeClient;
  }

  resolveDefaultProrationBehavior() {
    return normalizeStripeProrationBehavior(process.env.STRIPE_SUBSCRIPTION_PRORATION_BEHAVIOR, 'create_prorations');
  }

  getPublicConfig() {
    const publishableKey = String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
    if (!publishableKey) {
      return {
        status: 503,
        body: {
          error: 'billing_not_configured',
          message: 'Stripe publishable key is not configured.'
        }
      };
    }
    return {
      status: 200,
      body: {
        provider: BILLING_PROVIDER,
        publishableKey
      }
    };
  }

  async getSubscription(userId) {
    const sub = await this.stateService.getOrCreateSubscription(userId);
    return this.stateService.mapStoredSubscriptionResponse(sub);
  }

  async syncSubscription(userId) {
    if (!this.isStripeConfigured()) {
      return {
        status: 503,
        body: { error: 'billing_not_configured', message: 'Stripe credentials are not configured.' }
      };
    }

    const user = await this.stateService.getUserById(userId);
    if (!user) return { status: 404, body: { error: 'user_not_found' } };

    const stripe = this.getStripeClient();
    const subscription = await this.stateService.resolveSubscriptionForBillingMutation({ stripe, user });
    const synced = await this.stateService.persistStripeSubscriptionState(subscription, {
      auditAction: 'billing.subscription.synced'
    });
    if (!synced) return { status: 404, body: { error: 'billing_subscription_not_found' } };

    return {
      status: 200,
      body: {
        ok: true,
        provider: BILLING_PROVIDER,
        subscription: {
          id: synced.id,
          status: synced.status,
          planId: synced.planId,
          planType: synced.planType,
          currentPeriodEnd: synced.currentPeriodEnd,
          cancelAtPeriodEnd: synced.cancelAtPeriodEnd,
          isPremium: synced.planType !== 'free' && synced.status !== 'canceled'
        }
      }
    };
  }

  async changePlan(userId, { planType, prorationBehavior }) {
    if (!this.isStripeConfigured()) {
      return {
        status: 503,
        body: { error: 'billing_not_configured', message: 'Stripe credentials are not configured.' }
      };
    }

    const user = await this.stateService.getUserById(userId);
    if (!user) return { status: 404, body: { error: 'user_not_found' } };

    const stripe = this.getStripeClient();
    const subscription = await this.stateService.resolveSubscriptionForBillingMutation({ stripe, user });
    const updated = await this.stateService.updateSubscriptionPlan({
      stripe,
      subscription,
      targetPlanType: planType,
      prorationBehavior,
      userId,
      defaultProrationBehavior: this.resolveDefaultProrationBehavior()
    });

    return {
      status: 200,
      body: {
        ok: true,
        provider: BILLING_PROVIDER,
        subscription: this.stateService.buildSubscriptionPayload(updated)
      }
    };
  }

  async cancelSubscription(userId, { cancelAtPeriodEnd }) {
    if (!this.isStripeConfigured()) {
      return {
        status: 503,
        body: { error: 'billing_not_configured', message: 'Stripe credentials are not configured.' }
      };
    }

    const user = await this.stateService.getUserById(userId);
    if (!user) return { status: 404, body: { error: 'user_not_found' } };

    const stripe = this.getStripeClient();
    const subscription = await this.stateService.resolveSubscriptionForBillingMutation({ stripe, user });
    const updated = await this.stateService.cancelSubscription({
      stripe,
      subscription,
      cancelAtPeriodEnd: Boolean(cancelAtPeriodEnd)
    });

    return {
      status: 200,
      body: {
        ok: true,
        provider: BILLING_PROVIDER,
        canceledAtPeriodEnd: Boolean(cancelAtPeriodEnd),
        subscription: this.stateService.buildSubscriptionPayload(updated, 'free')
      }
    };
  }

  async resumeSubscription(userId, { reactivateNow }) {
    if (!this.isStripeConfigured()) {
      return {
        status: 503,
        body: { error: 'billing_not_configured', message: 'Stripe credentials are not configured.' }
      };
    }

    const user = await this.stateService.getUserById(userId);
    if (!user) return { status: 404, body: { error: 'user_not_found' } };

    const stripe = this.getStripeClient();
    const subscription = await this.stateService.resolveSubscriptionForBillingMutation({ stripe, user });
    const updated = await this.stateService.resumeSubscription({
      stripe,
      subscription,
      reactivateNow: Boolean(reactivateNow)
    });

    return {
      status: 200,
      body: {
        ok: true,
        provider: BILLING_PROVIDER,
        subscription: this.stateService.buildSubscriptionPayload(updated)
      }
    };
  }

  async createCheckout(userId, payload) {
    if (!this.isStripeConfigured()) {
      return {
        status: 503,
        body: { error: 'billing_not_configured', message: 'Stripe credentials are not configured.' }
      };
    }

    const user = await this.stateService.getUserById(userId);
    if (!user) return { status: 404, body: { error: 'user_not_found' } };

    const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    const inlinePriceRequested = String(process.env.STRIPE_ALLOW_INLINE_PRICE_DATA || '').trim().toLowerCase() === 'true';
    if (isProduction && inlinePriceRequested) {
      this.logger.warn({ endpoint: '/api/billing/checkout' }, 'stripe_inline_price_data_forced_off_in_production');
    }
    const stripePriceId = this.stateService.planToStripePriceId(payload.planType);
    const allowInlinePriceData = !isProduction && inlinePriceRequested;
    const inlinePriceData = stripePriceId || !allowInlinePriceData ? null : this.stateService.planToInlinePriceData(payload.planType);
    if (!stripePriceId && !inlinePriceData) {
      return {
        status: 500,
        body: {
          error: 'billing_plan_not_configured',
          message: `Missing Stripe price mapping for ${payload.planType}.`
        }
      };
    }

    const stripe = this.getStripeClient();
    const customerId = await this.stateService.ensureStripeCustomerForUser({ stripe, user });
    const successUrl = resolveAbsoluteUrl(payload.successUrl, '/billing/success?session_id={CHECKOUT_SESSION_ID}');
    const cancelUrl = resolveAbsoluteUrl(payload.cancelUrl, '/billing/cancel');

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [stripePriceId ? { price: stripePriceId, quantity: 1 } : { price_data: inlinePriceData, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: String(user.id || userId || ''),
      subscription_data: {
        metadata: {
          user_id: String(user.id || userId || ''),
          plan_type: payload.planType
        }
      },
      metadata: {
        user_id: String(user.id || userId || ''),
        plan_type: payload.planType
      }
    });

    const revenueEur = inlinePriceData
      ? Number(inlinePriceData.unit_amount || 0) / 100
      : resolveConfiguredPlanPriceEur(payload.planType);
    const stripeFeeEur = estimateStripeFeeForCheckout(revenueEur);
    const netMarginEur =
      Number.isFinite(revenueEur) && Number.isFinite(stripeFeeEur)
        ? round4(revenueEur - stripeFeeEur)
        : null;

    logEconomicEvent('checkout_created', {
      user_id: String(user.id || userId || ''),
      user_tier: payload.planType,
      plan_type: payload.planType,
      price_id: stripePriceId,
      price_eur: revenueEur,
      revenue_eur: revenueEur,
      stripe_fee_eur: stripeFeeEur,
      net_margin_eur: netMarginEur,
      session_id: session?.id,
      customer_id: customerId
    });

    await this.stateService.appendImmutableAudit({
      actor: 'billing_checkout',
      action: 'billing.checkout.created',
      target: String(user.id || userId || ''),
      metadata: {
        provider: BILLING_PROVIDER,
        sessionId: session?.id || null,
        customerId,
        planType: payload.planType
      }
    }).catch(() => {});

    return {
      status: 201,
      body: {
        ok: true,
        provider: BILLING_PROVIDER,
        planType: payload.planType,
        sessionId: session?.id || null,
        checkoutUrl: session?.url || null
      }
    };
  }

  async createPortal(userId, payload) {
    if (!this.isStripeConfigured()) {
      return {
        status: 503,
        body: { error: 'billing_not_configured', message: 'Stripe credentials are not configured.' }
      };
    }

    const user = await this.stateService.getUserById(userId);
    if (!user) return { status: 404, body: { error: 'user_not_found' } };

    const stripe = this.getStripeClient();
    const customerId = await this.stateService.ensureStripeCustomerForUser({ stripe, user });
    const returnUrl = resolveAbsoluteUrl(payload.returnUrl, '/settings/billing');

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl
    });

    return {
      status: 200,
      body: {
        ok: true,
        provider: BILLING_PROVIDER,
        url: portalSession?.url || null
      }
    };
  }

  async handleWebhook(req, res) {
    let stripeClientForWebhook = null;
    try {
      stripeClientForWebhook = this.getStripeClient();
    } catch {
      stripeClientForWebhook = null;
    }
    return this.webhookService.handleWebhookRequest({ req, res, stripeClient: stripeClientForWebhook });
  }
}
