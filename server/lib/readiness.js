import { parseFlag } from './env-flags.js';
import { getEmailReadiness } from './email/email-readiness.js';

const PLACEHOLDER_PATTERN = /replace-with|example|changeme|placeholder|todo|your-/i;

export function hasReadyValue(value, min = 4) {
  const raw = String(value || '').trim();
  if (raw.length < min) return false;
  return !PLACEHOLDER_PATTERN.test(raw);
}

export function getProviderReadiness(env = process.env) {
  const duffelReady = parseFlag(env.ENABLE_PROVIDER_DUFFEL, false) && hasReadyValue(env.DUFFEL_API_KEY, 8);
  const kiwiReady = parseFlag(env.ENABLE_PROVIDER_KIWI, false) && hasReadyValue(env.KIWI_API_KEY, 8);
  const liveProviderConfigured = duffelReady || kiwiReady;
  return {
    status: liveProviderConfigured ? 'PROVIDER_READY' : 'PROVIDER_NOT_READY',
    duffelReady,
    kiwiReady,
    liveProviderConfigured,
    providerNames: [kiwiReady ? 'kiwi' : null, duffelReady ? 'duffel' : null].filter(Boolean),
    publicCopy: liveProviderConfigured ? 'Live provider enabled' : 'Public cached opportunities'
  };
}

export function getBillingReadiness(env = process.env) {
  const billingProvider = String(env.BILLING_PROVIDER || 'stripe').trim().toLowerCase() || 'stripe';
  const stripeReady = hasReadyValue(env.STRIPE_SECRET_KEY, 16);
  const billingReady = billingProvider === 'stripe' && stripeReady;
  return {
    status: billingReady ? 'BILLING_READY' : 'BILLING_NOT_READY',
    billingProvider,
    stripeReady,
    billingReady,
    mockBillingEnabled: parseFlag(env.ALLOW_MOCK_BILLING_UPGRADES, false)
  };
}

export function getAlertDeliveryReadiness(env = process.env) {
  const emailReadiness = getEmailReadiness(env);
  const smtpReady = emailReadiness.status === 'EMAIL_READY';
  const browserPushEnabled = parseFlag(env.BROWSER_PUSH_ENABLED, false);
  const pushWebhookReady = hasReadyValue(env.PUSH_WEBHOOK_URL, 10);
  const vapidConfigured = hasReadyValue(env.VAPID_PUBLIC_KEY, 40) && hasReadyValue(env.VAPID_PRIVATE_KEY, 30);
  const vapidReady = browserPushEnabled && vapidConfigured;
  const pushReady = pushWebhookReady || vapidReady;
  return {
    status: smtpReady || pushReady ? 'ALERT_DELIVERY_READY' : 'ALERT_DELIVERY_NOT_READY',
    emailReadiness,
    smtpReady,
    browserPushEnabled,
    pushWebhookReady,
    vapidConfigured,
    vapidReady,
    pushReady,
    instantAlertsAvailable: smtpReady || pushReady,
    publicCopy:
      smtpReady || pushReady
        ? 'Alert delivery is enabled.'
        : 'Save this route. Email alerts will be enabled soon.'
  };
}
