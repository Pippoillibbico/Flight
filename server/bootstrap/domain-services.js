import { ORIGINS } from '../data/flights-data.js';
import { createAiIntentService, extractJsonObject, parseDecisionAiPayload, parseIntentAiPayload } from '../lib/ai/index.js';
import { createNotificationScanService } from '../lib/notification-scan-service.js';
import { createSubscriptionPricingMonitor } from '../lib/subscription-pricing-monitor.js';

export function createDomainServices({
  withDb,
  appendImmutableAudit,
  nanoid,
  env,
  fetchImpl,
  searchFlights,
  sendMail,
  insertEmailDeliveryLog,
  getCacheClient,
  logger,
  subscriptionScanCacheTtlSec,
  subscriptionScanLockTtlSec,
  runPriceAlertsWorkerOnce,
  priceAlertsWorkerLimit
}) {
  const monitorAndUpdateSubscriptionPricing = createSubscriptionPricingMonitor({
    withDb,
    appendImmutableAudit,
    nanoid,
    env,
    fetchImpl
  });

  const { scanSubscriptionsOnce } = createNotificationScanService({
    withDb,
    searchFlights,
    sendMail,
    insertEmailDeliveryLog,
    getCacheClient,
    logger,
    nanoid,
    scanCacheTtlSec: subscriptionScanCacheTtlSec,
    scanLockTtlSec: subscriptionScanLockTtlSec
  });

  const scanPriceAlertsOnce = async ({ limit = priceAlertsWorkerLimit } = {}) => runPriceAlertsWorkerOnce({ limit });
  const { enrichDecisionWithAi, parseIntentWithAi } = createAiIntentService({
    origins: ORIGINS,
    extractJsonObject,
    parseDecisionAiPayload,
    parseIntentAiPayload,
    cacheClient: getCacheClient()
  });

  return {
    monitorAndUpdateSubscriptionPricing,
    scanSubscriptionsOnce,
    scanPriceAlertsOnce,
    enrichDecisionWithAi,
    parseIntentWithAi
  };
}
