import { parseFlag } from './env-flags.js';

export function normalizeLaunchMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'soft') return 'soft';
  if (normalized === 'public' || normalized === 'production') return 'public';
  return 'public';
}

function hasReadyValue(value, min = 4) {
  const raw = String(value || '').trim();
  if (raw.length < min) return false;
  return !/replace-with|example|changeme|placeholder|todo|your-/i.test(raw);
}

export function getProviderReadiness(env = process.env) {
  const duffelReady = parseFlag(env.ENABLE_PROVIDER_DUFFEL, false) && hasReadyValue(env.DUFFEL_API_KEY, 8);
  return {
    status: duffelReady ? 'PROVIDER_READY' : 'PROVIDER_NOT_READY',
    duffelReady,
    liveProviderConfigured: duffelReady,
    publicCopy: duffelReady ? 'Live provider enabled' : 'Public cached opportunities'
  };
}

export function getAlertDeliveryReadiness(env = process.env) {
  const smtpReady = hasReadyValue(env.SMTP_HOST, 3) && hasReadyValue(env.SMTP_USER, 3) && hasReadyValue(env.SMTP_PASS, 8);
  const pushWebhookReady = hasReadyValue(env.PUSH_WEBHOOK_URL, 10);
  const vapidReady = hasReadyValue(env.VAPID_PUBLIC_KEY, 40) && hasReadyValue(env.VAPID_PRIVATE_KEY, 30);
  const pushReady = pushWebhookReady || vapidReady;
  return {
    status: smtpReady || pushReady ? 'ALERT_DELIVERY_READY' : 'ALERT_DELIVERY_NOT_READY',
    smtpReady,
    pushReady,
    instantAlertsAvailable: smtpReady || pushReady,
    publicCopy:
      smtpReady || pushReady
        ? 'Alert delivery is enabled.'
        : 'Save this route. Email alerts will be enabled soon.'
  };
}

export function getSoftLaunchFeatureMatrix(env = process.env) {
  const launchMode = normalizeLaunchMode(env.LAUNCH_MODE);
  const provider = getProviderReadiness(env);
  const alerts = getAlertDeliveryReadiness(env);
  const soft = launchMode === 'soft';

  return {
    launchMode,
    provider,
    alerts,
    available: soft
      ? [
          'public_cached_deals',
          'basic_route_search_cache',
          'basic_route_insights',
          'price_trend_preview',
          'cached_radar_preview',
          'signup_login',
          'pricing',
          'stripe_readiness',
          'outbound_handoff',
          'gdpr_cookie'
        ]
      : ['full_product_per_plan'],
    disabled: soft
      ? [
          'ai_for_free',
          'multi_city_live_for_free',
          'deep_scan_for_free',
          'per_user_scans_for_free',
          provider.duffelReady ? null : 'live_fares_copy_and_live_scan',
          alerts.instantAlertsAvailable ? null : 'instant_alerts_copy_and_delivery'
        ].filter(Boolean)
      : [],
    hidden: soft
      ? [
          'advanced_ai_for_free',
          'push_alerts_when_delivery_missing',
          'advanced_personal_hub',
          'advanced_admin',
          'unready_demo_features'
        ]
      : [],
    userMessages: {
      dataSource: provider.duffelReady
        ? 'Live provider data is available for paid live features.'
        : 'Flight opportunities are based on public cached scans.',
      alerts: alerts.publicCopy,
      freeAi: 'Free includes public cached deals and basic route insights. AI tools are available on paid plans.'
    }
  };
}
