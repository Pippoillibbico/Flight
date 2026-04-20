import Stripe from 'stripe';
import { logEconomicEvent } from '../economic-logger.js';

const STRIPE_API_VERSION = '2026-02-25.clover';
const STRIPE_INVOICE_FEE_RATE = 0.029;
const STRIPE_INVOICE_FEE_FIXED_EUR = 0.3;

function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function amountMinorToMajor(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return round4(amount / 100);
}

function estimateStripeInvoiceFee(revenueEur) {
  const revenue = Number(revenueEur);
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  return round4(revenue * STRIPE_INVOICE_FEE_RATE + STRIPE_INVOICE_FEE_FIXED_EUR);
}

export class StripeBillingWebhookService {
  constructor({
    billingProvider,
    stateService,
    claimStripeWebhookEvent,
    finalizeStripeWebhookEvent,
    logger
  }) {
    this.billingProvider = billingProvider;
    this.stateService = stateService;
    this.claimStripeWebhookEvent = claimStripeWebhookEvent;
    this.finalizeStripeWebhookEvent = finalizeStripeWebhookEvent;
    this.logger = logger;
  }

  defaultStripeClientForWebhookVerification() {
    return new Stripe('sk_test_local_webhook_verifier_1234567890', { apiVersion: STRIPE_API_VERSION });
  }

  parseStripeWebhookEvent({ rawBody, signatureHeader, webhookSecret, stripeClient }) {
    const payload = String(rawBody || '');
    const signature = String(signatureHeader || '').trim();
    const secret = String(webhookSecret || '').trim();

    if (!secret) {
      throw Object.assign(new Error('Missing STRIPE_WEBHOOK_SECRET'), { code: 'stripe_webhook_secret_missing' });
    }
    if (!signature) {
      throw Object.assign(new Error('Missing Stripe signature header'), { code: 'stripe_webhook_signature_missing' });
    }

    const verifier =
      stripeClient && stripeClient.webhooks && typeof stripeClient.webhooks.constructEvent === 'function'
        ? stripeClient
        : this.defaultStripeClientForWebhookVerification();

    return verifier.webhooks.constructEvent(payload, signature, secret);
  }

  async updateStripeCustomerMappingFromCheckoutSession(session) {
    const userId = String(session?.metadata?.user_id || session?.client_reference_id || '').trim();
    const customerId = String(session?.customer || '').trim();
    if (!userId || !customerId) return;
    await this.stateService.setUserStripeCustomerId({ userId, customerId });
  }

  async syncInvoiceSubscriptionIfAvailable(invoice, stripe, auditAction) {
    const subscriptionId = String(invoice?.subscription || '').trim();
    if (!subscriptionId || !stripe?.subscriptions?.retrieve) return;
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await this.stateService.persistStripeSubscriptionState(subscription, { auditAction });
    } catch (error) {
      this.logger.warn(
        { err: error, stripe_subscription_id: subscriptionId, stripe_invoice_id: invoice?.id || null },
        'stripe_invoice_subscription_sync_failed'
      );
    }
  }

  async handleStripeEvent(event, { stripe }) {
    const type = String(event?.type || '').trim();
    const data = event?.data || {};

    switch (type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = data.object;
        await this.stateService.persistStripeSubscriptionState(sub, {
          auditAction: `billing.subscription.${type === 'customer.subscription.created' ? 'created' : 'updated'}`
        });
        if (type === 'customer.subscription.created') {
          logEconomicEvent('subscription_created', {
            user_id: sub?.metadata?.user_id,
            stripe_subscription_id: sub?.id,
            stripe_customer_id: sub?.customer,
            plan_id: sub?.items?.data?.[0]?.price?.id,
            plan_type: sub?.metadata?.plan_type
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = data.object;
        await this.stateService.persistStripeSubscriptionState(
          {
            ...sub,
            status: 'canceled',
            metadata: {
              ...(sub?.metadata || {}),
              plan_type: 'free'
            }
          },
          {
            auditAction: 'billing.subscription.deleted'
          }
        );
        break;
      }

      case 'checkout.session.completed': {
        const session = data.object;
        await this.updateStripeCustomerMappingFromCheckoutSession(session);

        const subscriptionId = String(session?.subscription || '').trim();
        if (subscriptionId && stripe?.subscriptions?.retrieve) {
          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            await this.stateService.persistStripeSubscriptionState(subscription, {
              auditAction: 'billing.checkout.completed'
            });
          } catch (error) {
            this.logger.warn({ err: error, stripe_subscription_id: subscriptionId }, 'stripe_checkout_subscription_sync_failed');
          }
        } else {
          const userId = String(session?.metadata?.user_id || session?.client_reference_id || '').trim();
          if (userId) {
            await this.stateService.appendImmutableAudit({
              actor: 'stripe',
              action: 'billing.checkout.completed',
              target: userId,
              metadata: {
                checkoutSessionId: session?.id || null,
                stripeSubscriptionId: subscriptionId || null,
                stripeCustomerId: session?.customer || null
              }
            }).catch(() => {});
          }
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = data.object;
        await this.syncInvoiceSubscriptionIfAvailable(invoice, stripe, 'billing.payment_succeeded.sync');
        const userId = await this.stateService.resolveUserIdFromStripeCustomer(invoice?.customer);
        const currency = String(invoice?.currency || '').trim().toUpperCase();
        const revenueEur = currency === 'EUR' ? amountMinorToMajor(invoice?.amount_paid) : null;
        const stripeFeeEur = estimateStripeInvoiceFee(revenueEur);
        const netMarginEur =
          Number.isFinite(revenueEur) && Number.isFinite(stripeFeeEur)
            ? round4(revenueEur - stripeFeeEur)
            : null;

        logEconomicEvent('payment_received', {
          user_id: userId || null,
          user_tier: invoice?.lines?.data?.[0]?.plan?.nickname || null,
          revenue_eur: revenueEur,
          stripe_fee_eur: stripeFeeEur,
          net_margin_eur: netMarginEur,
          extra: {
            invoice_id: invoice?.id || null,
            stripe_customer_id: invoice?.customer || null,
            stripe_subscription_id: invoice?.subscription || null,
            currency: currency || null,
            amount_paid_minor: Number.isFinite(Number(invoice?.amount_paid)) ? Number(invoice.amount_paid) : null
          }
        });

        if (userId) {
          await this.stateService.appendImmutableAudit({
            actor: 'stripe',
            action: 'billing.payment_succeeded',
            target: userId,
            metadata: {
              invoiceId: invoice?.id || null,
              amountPaid: invoice?.amount_paid ?? null,
              currency: invoice?.currency || null
            }
          }).catch(() => {});
        }
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const sub = data.object;
        const userId = sub?.metadata?.user_id ?? (await this.stateService.resolveUserIdFromStripeCustomer(sub?.customer));
        if (userId) {
          await this.stateService.appendImmutableAudit({
            actor: 'stripe',
            action: 'billing.subscription.trial_will_end',
            target: userId,
            metadata: {
              subscriptionId: sub?.id || null,
              currentPeriodEnd: sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null
            }
          }).catch(() => {});
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = data.object;
        await this.syncInvoiceSubscriptionIfAvailable(invoice, stripe, 'billing.payment_failed.sync');
        const userId = await this.stateService.resolveUserIdFromStripeCustomer(invoice?.customer);
        const currency = String(invoice?.currency || '').trim().toUpperCase();
        const dueEur = currency === 'EUR' ? amountMinorToMajor(invoice?.amount_due) : null;
        logEconomicEvent('payment_failed', {
          user_id: userId || null,
          revenue_eur: dueEur,
          extra: {
            invoice_id: invoice?.id || null,
            stripe_customer_id: invoice?.customer || null,
            stripe_subscription_id: invoice?.subscription || null,
            currency: currency || null,
            amount_due_minor: Number.isFinite(Number(invoice?.amount_due)) ? Number(invoice.amount_due) : null
          }
        });
        if (userId) {
          await this.stateService.appendImmutableAudit({
            actor: 'stripe',
            action: 'billing.payment_failed',
            target: userId,
            metadata: { invoiceId: invoice?.id || null, amount: invoice?.amount_due ?? null }
          }).catch(() => {});
        }
        break;
      }

      default:
        this.logger.info({ stripe_event_type: type }, 'stripe_webhook_event_ignored');
        break;
    }
  }

  async handleWebhookRequest({ req, res, stripeClient }) {
    const signature = String(req.headers['stripe-signature'] || '').trim();
    const secret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();

    if (!secret) {
      this.logger.warn({ endpoint: '/api/billing/webhook' }, 'stripe_webhook_secret_missing');
      if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
        return res.status(503).json({ error: 'billing_not_configured' });
      }
      return res.json({ received: true });
    }

    const rawBody =
      req.rawBody ??
      (Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body || {}));

    let event;
    try {
      event = this.parseStripeWebhookEvent({
        rawBody,
        signatureHeader: signature,
        webhookSecret: secret,
        stripeClient
      });
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          endpoint: '/api/billing/webhook'
        },
        'stripe_webhook_signature_invalid'
      );
      return res.status(400).json({ error: 'Invalid Stripe signature.' });
    }

    const stripeKeyPrefix = String(process.env.STRIPE_SECRET_KEY || '').trim().slice(0, 8).toLowerCase();
    const expectsLiveMode = stripeKeyPrefix.startsWith('sk_live_');
    const expectsTestMode = stripeKeyPrefix.startsWith('sk_test_');
    if (typeof event?.livemode === 'boolean') {
      const mismatch = (expectsLiveMode && event.livemode === false) || (expectsTestMode && event.livemode === true);
      if (mismatch) {
        this.logger.warn(
          {
            endpoint: '/api/billing/webhook',
            stripe_event_id: event?.id || null,
            stripe_event_type: event?.type || null,
            stripe_event_livemode: event.livemode,
            stripe_key_mode: expectsLiveMode ? 'live' : expectsTestMode ? 'test' : 'unknown'
          },
          'stripe_webhook_mode_mismatch'
        );
        return res.status(400).json({ error: 'stripe_webhook_mode_mismatch' });
      }
    }

    const eventId = String(event?.id || '').trim();
    if (!eventId) {
      this.logger.warn({ endpoint: '/api/billing/webhook' }, 'stripe_webhook_missing_event_id');
      return res.json({ received: true, deduped: false });
    }

    try {
      const claim = await this.claimStripeWebhookEvent({
        id: eventId,
        type: String(event?.type || 'unknown')
      });
      if (!claim?.claimed) {
        this.logger.info(
          {
            billing_provider: this.billingProvider,
            billing_event_id: eventId,
            stripe_event_type: event?.type,
            reason: claim?.reason || 'already_processed'
          },
          'billing_webhook_deduped'
        );
        return res.json({ received: true, deduped: true });
      }

      await this.handleStripeEvent(event, { stripe: stripeClient });

      await this.finalizeStripeWebhookEvent({ id: eventId, status: 'processed' });
      this.logger.info(
        { billing_provider: this.billingProvider, billing_event_id: eventId, stripe_event_type: event?.type },
        'billing_webhook_processed'
      );
      return res.json({ received: true, deduped: false });
    } catch (error) {
      await this.finalizeStripeWebhookEvent({
        id: eventId,
        status: 'failed',
        errorMessage: error?.message || 'webhook_processing_failed'
      }).catch(() => {});
      this.logger.error(
        { err: error, endpoint: '/api/billing/webhook', stripe_event_type: event?.type, billing_provider: this.billingProvider },
        'billing_webhook_handler_error'
      );
      return res.status(500).json({ error: 'webhook_processing_failed' });
    }
  }
}
