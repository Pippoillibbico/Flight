import { PLANS } from '../saas-db.js';
import { planIdToPublicPlanType, normalizeStripeProrationBehavior, normalizeSubscriptionStatus } from './stripe-billing-utils.js';

export class StripeBillingStateService {
  constructor({
    readDb,
    withDb,
    getOrCreateSubscription,
    upsertSubscriptionFromProvider,
    appendImmutableAudit,
    setUserPlan,
    logger
  }) {
    this.readDb = readDb;
    this.withDb = withDb;
    this.getOrCreateSubscription = getOrCreateSubscription;
    this.upsertSubscriptionFromProvider = upsertSubscriptionFromProvider;
    this.appendImmutableAudit = appendImmutableAudit;
    this.setUserPlan = setUserPlan;
    this.logger = logger;
  }

  planFromStripePrice(priceId) {
    const value = String(priceId || '').trim();
    if (!value) return 'free';
    const proPrice = String(process.env.STRIPE_PRICE_PRO || '').trim();
    const creatorPrice = String(process.env.STRIPE_PRICE_CREATOR || '').trim();
    if (value && proPrice && value === proPrice) return 'pro';
    if (value && creatorPrice && value === creatorPrice) return 'creator';
    return 'free';
  }

  planToStripePriceId(planType) {
    const normalized = String(planType || '').trim().toLowerCase();
    if (normalized === 'pro') return String(process.env.STRIPE_PRICE_PRO || '').trim();
    if (normalized === 'elite' || normalized === 'creator') return String(process.env.STRIPE_PRICE_CREATOR || '').trim();
    return '';
  }

  normalizePlanTypeForSubscription(rawValue) {
    const value = String(rawValue || '').trim().toLowerCase();
    if (value === 'pro') return 'pro';
    if (value === 'elite' || value === 'creator') return 'creator';
    return 'free';
  }

  planToInlinePriceData(planType) {
    const normalized = String(planType || '').trim().toLowerCase();
    const plan = normalized === 'pro' ? PLANS.pro : normalized === 'elite' || normalized === 'creator' ? PLANS.creator : null;
    if (!plan) return null;
    const unitAmount = Math.round(Number(plan.priceEur || 0) * 100);
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) return null;
    return {
      currency: 'eur',
      recurring: { interval: 'month' },
      unit_amount: unitAmount,
      product_data: {
        name: `Flight Suite ${plan.name}`
      }
    };
  }

  async getUserById(userId) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) return null;
    try {
      const db = await this.readDb();
      return (db.users || []).find((entry) => entry.id === safeUserId) || null;
    } catch {
      return null;
    }
  }

  async resolveUserIdFromStripeCustomer(stripeCustomerId) {
    const customerId = String(stripeCustomerId || '').trim();
    if (!customerId) return null;
    try {
      const db = await this.readDb();
      const user = (db.users || []).find((entry) => String(entry.stripeCustomerId || '').trim() === customerId);
      return user?.id ?? null;
    } catch {
      return null;
    }
  }

  async setUserStripeCustomerId({ userId, customerId }) {
    const safeUserId = String(userId || '').trim();
    const safeCustomerId = String(customerId || '').trim();
    if (!safeUserId || !safeCustomerId) return;
    await this.withDb((db) => {
      const user = (db.users || []).find((entry) => entry.id === safeUserId);
      if (!user) return db;
      user.stripeCustomerId = safeCustomerId;
      user.updatedAt = new Date().toISOString();
      return db;
    });
  }

  async ensureStripeCustomerForUser({ stripe, user }) {
    const userId = String(user?.id || '').trim();
    const existing = String(user?.stripeCustomerId || '').trim();
    if (existing) {
      try {
        const customer = await stripe.customers.retrieve(existing);
        if (customer && !customer.deleted) return existing;
      } catch (error) {
        if (String(error?.code || '') !== 'resource_missing') throw error;
        this.logger.warn({ user_id: userId, stripe_customer_id: existing }, 'stripe_customer_id_stale_recovering');
      }
    }

    const userEmail = String(user?.email || '').trim().toLowerCase();
    if (userEmail) {
      try {
        const listed = await stripe.customers.list({ email: userEmail, limit: 10 });
        const candidates = Array.isArray(listed?.data) ? listed.data : [];
        const byMetadata = candidates.find((entry) => String(entry?.metadata?.user_id || '').trim() === userId);
        const selected = byMetadata || candidates[0] || null;
        if (selected?.id) {
          await this.setUserStripeCustomerId({ userId, customerId: selected.id });
          return selected.id;
        }
      } catch (error) {
        this.logger.warn({ err: error, user_id: userId }, 'stripe_customer_lookup_failed');
      }
    }

    const customer = await stripe.customers.create({
      email: userEmail || undefined,
      name: String(user?.name || '').trim() || undefined,
      metadata: {
        user_id: userId
      }
    });

    if (!customer?.id) {
      throw Object.assign(new Error('Unable to create Stripe customer.'), { code: 'billing_customer_create_failed' });
    }

    await this.setUserStripeCustomerId({ userId, customerId: customer.id });
    return customer.id;
  }

  extractStripePriceId(subscription) {
    return String(subscription?.items?.data?.[0]?.price?.id || '').trim();
  }

  isStripeSubscriptionActiveLike(status) {
    const normalized = normalizeSubscriptionStatus(status);
    return normalized === 'active' || normalized === 'trialing' || normalized === 'past_due' || normalized === 'unpaid';
  }

  selectPrimaryStripeSubscription(subscriptions) {
    const list = Array.isArray(subscriptions) ? subscriptions.filter(Boolean) : [];
    if (list.length === 0) return null;
    const activeLike = list.find((entry) => this.isStripeSubscriptionActiveLike(entry?.status));
    if (activeLike) return activeLike;
    return [...list].sort((a, b) => Number(b?.created || 0) - Number(a?.created || 0))[0] || null;
  }

  buildSubscriptionPayload(subscription, fallbackPlanId = 'free') {
    const priceId = this.extractStripePriceId(subscription);
    const planFromMetadata = this.normalizePlanTypeForSubscription(subscription?.metadata?.plan_type);
    const planFromPrice = this.planFromStripePrice(priceId);
    const planId = planFromPrice === 'free' ? planFromMetadata : planFromPrice;
    const normalizedPlanId = planId || fallbackPlanId;
    const status = normalizeSubscriptionStatus(subscription?.status);
    const effectivePlan = status === 'canceled' || status === 'incomplete_expired' ? 'free' : normalizedPlanId;

    return {
      id: String(subscription?.id || '').trim() || null,
      status,
      planId: normalizedPlanId,
      planType: planIdToPublicPlanType(effectivePlan),
      priceId: priceId || null,
      currentPeriodStart: subscription?.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null,
      currentPeriodEnd: subscription?.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
      cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end)
    };
  }

  async persistStripeSubscriptionState(subscription, { auditAction = null } = {}) {
    const userId = subscription?.metadata?.user_id ?? (await this.resolveUserIdFromStripeCustomer(subscription?.customer));
    if (!userId) {
      this.logger.warn({ stripe_subscription_id: subscription?.id }, 'stripe_subscription_user_missing');
      return null;
    }

    const payload = this.buildSubscriptionPayload(subscription);

    await this.upsertSubscriptionFromProvider({
      userId,
      stripeSubscriptionId: payload.id,
      stripeCustomerId: subscription?.customer,
      planId: payload.planId,
      status: payload.status,
      currentPeriodStart: payload.currentPeriodStart || new Date().toISOString(),
      currentPeriodEnd: payload.currentPeriodEnd,
      cancelAtPeriodEnd: payload.cancelAtPeriodEnd
    });

    await this.setUserPlan({
      userId,
      planType: payload.planType,
      status: payload.status
    });

    if (auditAction) {
      await this.appendImmutableAudit({
        actor: 'stripe',
        action: auditAction,
        target: userId,
        metadata: {
          subscriptionId: payload.id,
          status: payload.status,
          planId: payload.planId,
          priceId: payload.priceId,
          cancelAtPeriodEnd: payload.cancelAtPeriodEnd
        }
      }).catch(() => {});
    }

    return {
      userId,
      ...payload
    };
  }

  async resolveStripeSubscriptionForUser({ stripe, user, localSubscription }) {
    const localSubscriptionId = String(localSubscription?.stripe_subscription_id || localSubscription?.stripeSubscriptionId || '').trim();
    if (localSubscriptionId) {
      try {
        return await stripe.subscriptions.retrieve(localSubscriptionId);
      } catch (error) {
        if (String(error?.code || '') !== 'resource_missing') throw error;
        this.logger.warn({ user_id: user?.id, stripe_subscription_id: localSubscriptionId }, 'stripe_subscription_id_stale_recovering');
      }
    }

    const customerId = await this.ensureStripeCustomerForUser({ stripe, user });
    const listed = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 25 });
    return this.selectPrimaryStripeSubscription(listed?.data || []);
  }

  async resolveSubscriptionForBillingMutation({ stripe, user }) {
    const localSubscription = await this.getOrCreateSubscription(user.id);
    const subscription = await this.resolveStripeSubscriptionForUser({
      stripe,
      user,
      localSubscription
    });
    if (!subscription) {
      throw Object.assign(new Error('No Stripe subscription found for this account.'), { code: 'billing_subscription_not_found' });
    }
    return subscription;
  }

  resolvePrimarySubscriptionItemId(subscription) {
    const itemId = String(subscription?.items?.data?.[0]?.id || '').trim();
    if (!itemId) {
      throw Object.assign(new Error('Stripe subscription item missing.'), { code: 'billing_subscription_item_missing' });
    }
    return itemId;
  }

  async updateSubscriptionPlan({ stripe, subscription, targetPlanType, prorationBehavior, userId, defaultProrationBehavior }) {
    const priceId = this.planToStripePriceId(targetPlanType);
    if (!priceId) {
      throw Object.assign(new Error(`Missing Stripe price mapping for ${targetPlanType}.`), {
        code: 'billing_plan_not_configured'
      });
    }

    const itemId = this.resolvePrimarySubscriptionItemId(subscription);
    const updated = await stripe.subscriptions.update(subscription.id, {
      items: [{ id: itemId, price: priceId, quantity: 1 }],
      proration_behavior: normalizeStripeProrationBehavior(prorationBehavior, defaultProrationBehavior),
      cancel_at_period_end: false,
      metadata: {
        ...(subscription?.metadata || {}),
        user_id: String(userId || '').trim(),
        plan_type: targetPlanType
      }
    });

    await this.persistStripeSubscriptionState(updated, {
      auditAction: 'billing.subscription.plan_changed'
    });
    return updated;
  }

  async cancelSubscription({ stripe, subscription, cancelAtPeriodEnd }) {
    let nextSubscription = null;
    if (cancelAtPeriodEnd) {
      nextSubscription = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true
      });
    } else {
      nextSubscription = await stripe.subscriptions.cancel(subscription.id);
    }

    await this.persistStripeSubscriptionState(
      cancelAtPeriodEnd
        ? nextSubscription
        : {
            ...nextSubscription,
            status: 'canceled',
            metadata: {
              ...(nextSubscription?.metadata || {}),
              plan_type: 'free'
            }
          },
      {
        auditAction: cancelAtPeriodEnd ? 'billing.subscription.cancel_scheduled' : 'billing.subscription.canceled_immediately'
      }
    );
    return nextSubscription;
  }

  async resumeSubscription({ stripe, subscription, reactivateNow }) {
    let nextSubscription = subscription;
    if (subscription.cancel_at_period_end) {
      nextSubscription = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: false
      });
    }

    if (reactivateNow && subscription.status === 'canceled' && stripe.subscriptions.resume) {
      try {
        nextSubscription = await stripe.subscriptions.resume(subscription.id);
      } catch (error) {
        this.logger.warn({ err: error, stripe_subscription_id: subscription.id }, 'stripe_subscription_resume_failed');
      }
    }

    await this.persistStripeSubscriptionState(nextSubscription, {
      auditAction: 'billing.subscription.resume'
    });
    return nextSubscription;
  }

  mapStoredSubscriptionResponse(sub) {
    const planId = String(sub?.plan_id ?? sub?.planId ?? 'free').trim().toLowerCase() || 'free';
    const planType = planIdToPublicPlanType(planId);
    const status = normalizeSubscriptionStatus(sub?.status ?? 'active');
    return {
      planId,
      planType,
      status,
      currentPeriodEnd: sub?.current_period_end ?? sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end ?? sub?.cancelAtPeriodEnd ?? false),
      extraCredits: Number(sub?.extra_credits ?? sub?.extraCredits ?? 0),
      isPremium: planType !== 'free' && status !== 'canceled',
      stripeSubscriptionId: String((sub?.stripe_subscription_id ?? sub?.stripeSubscriptionId) || '').trim() || null,
      stripeCustomerId: String((sub?.stripe_customer_id ?? sub?.stripeCustomerId) || '').trim() || null
    };
  }
}
