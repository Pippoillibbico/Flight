export { getAlertDeliveryReadiness, getProviderReadiness } from './readiness.js';
import { getAlertDeliveryReadiness, getProviderReadiness } from './readiness.js';

export function normalizeLaunchMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'soft') return 'soft';
  if (normalized === 'public' || normalized === 'production') return 'public';
  return 'public';
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
          provider.liveProviderConfigured ? null : 'live_fares_copy_and_live_scan',
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
      dataSource: provider.liveProviderConfigured
        ? 'Live provider data is available for paid live features.'
        : 'Flight opportunities are based on public cached scans.',
      alerts: alerts.publicCopy,
      freeAi: 'Free includes public cached deals and basic route insights. AI tools are available on paid plans.'
    }
  };
}
