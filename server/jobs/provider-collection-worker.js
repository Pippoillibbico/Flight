import { addDays, format } from 'date-fns';
import {
  createIngestionJob,
  ingestPriceObservation,
  listActiveDiscoverySubscriptions,
  listPopularRoutePairs,
  updateIngestionJob,
  upsertProviderRunState
} from '../lib/deal-engine-store.js';
import { createProviderRegistry } from '../lib/providers/provider-registry.js';
import { loadSeedRoutes } from '../lib/seed-routes.js';
import { mapLimit } from '../lib/discovery-score.js';
import { logger } from '../lib/logger.js';

function parseFlag(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function buildRouteSet(seedRoutes, popularRoutes, subscriptions, limit) {
  const map = new Map();
  for (const [origin, destinations] of Object.entries(seedRoutes?.origins || {})) {
    for (const destination of destinations) {
      map.set(`${origin}-${destination}`, { originIata: origin, destinationIata: destination, source: 'seed' });
    }
  }
  for (const row of popularRoutes) {
    map.set(`${row.originIata}-${row.destinationIata}`, { originIata: row.originIata, destinationIata: row.destinationIata, source: 'popular' });
  }
  for (const row of subscriptions) {
    const origin = String(row.origin_iata || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin)) continue;
    map.set(`${origin}-*`, { originIata: origin, destinationIata: null, source: 'subscription' });
  }
  return Array.from(map.values()).slice(0, Math.max(1, Number(limit) || 200));
}

export async function runProviderCollectionOnce() {
  const enabled = parseFlag(process.env.PROVIDER_COLLECTION_ENABLED, false);
  if (!enabled) return { processedCount: 0, insertedCount: 0, dedupedCount: 0, failedCount: 0, skipped: true };

  const routeLimit = Math.max(1, Math.min(1000, Number(process.env.PROVIDER_COLLECTION_LIMIT_ROUTES || 200)));
  const horizonDays = Math.max(14, Math.min(365, Number(process.env.PROVIDER_COLLECTION_HORIZON_DAYS || 180)));
  const concurrency = Math.max(1, Math.min(20, Number(process.env.PROVIDER_COLLECTION_CONCURRENCY || 5)));

  const registry = createProviderRegistry();
  const providerStates = registry.listProviders();
  const configuredProviders = providerStates.filter((p) => p.enabled && p.configured);
  if (!configuredProviders.length) {
    logger.warn({ providers: providerStates }, 'provider_collection_no_configured_provider');
    return { processedCount: 0, insertedCount: 0, dedupedCount: 0, failedCount: 0, skipped: true };
  }

  const job = await createIngestionJob({
    jobType: 'provider_collection',
    source: 'partner_feed',
    status: 'running',
    metadata: { routeLimit, horizonDays, concurrency, providers: providerStates }
  });
  await updateIngestionJob({ jobId: job.id, startedAt: new Date().toISOString(), status: 'running' });

  let processedCount = 0;
  let insertedCount = 0;
  let dedupedCount = 0;
  let failedCount = 0;

  try {
    const [seedRoutes, popularRoutes, subscriptions] = await Promise.all([
      loadSeedRoutes().catch(() => ({ origins: {} })),
      listPopularRoutePairs({ limit: routeLimit }),
      listActiveDiscoverySubscriptions()
    ]);
    const routeSet = buildRouteSet(seedRoutes, popularRoutes, subscriptions, routeLimit);
    const departureDate = format(addDays(new Date(), 30), 'yyyy-MM-dd');
    const returnDate = format(addDays(new Date(), Math.min(30 + 6, horizonDays)), 'yyyy-MM-dd');

    await mapLimit(routeSet, concurrency, async (route) => {
      const destinationCandidates =
        route.destinationIata && /^[A-Z]{3}$/.test(route.destinationIata) ? [route.destinationIata] : (seedRoutes?.origins?.[route.originIata] || []).slice(0, 5);
      for (const destinationIata of destinationCandidates) {
        processedCount += 1;
        const offers = await registry.searchOffers({
          originIata: route.originIata,
          destinationIata,
          departureDate,
          returnDate,
          adults: 1,
          cabinClass: 'economy'
        });
        for (const offer of offers) {
          try {
            const out = await ingestPriceObservation({
              origin_iata: offer.originIata,
              destination_iata: offer.destinationIata,
              departure_date: offer.departureDate,
              return_date: offer.returnDate,
              currency: offer.currency,
              total_price: offer.totalPrice,
              provider: offer.provider,
              cabin_class: offer.cabinClass,
              trip_type: offer.tripType,
              observed_at: offer.observedAt,
              source: offer.source || 'partner_feed',
              metadata: offer.metadata || {}
            });
            if (out.inserted) insertedCount += 1;
            else dedupedCount += 1;
          } catch {
            failedCount += 1;
          }
        }
      }
    });

    for (const provider of configuredProviders) {
      await upsertProviderRunState({
        providerName: provider.name,
        lastSuccessAt: new Date().toISOString(),
        lastCursor: departureDate,
        lastRouteBatch: JSON.stringify({ routeCount: routeSet.length })
      });
    }

    const status = failedCount > 0 ? (insertedCount > 0 ? 'partial' : 'failed') : 'success';
    await updateIngestionJob({
      jobId: job.id,
      status,
      finishedAt: new Date().toISOString(),
      processedCount,
      insertedCount,
      dedupedCount,
      failedCount
    });
    logger.info({ processedCount, insertedCount, dedupedCount, failedCount, routeCount: routeSet.length }, 'provider_collection_worker_completed');
    return { processedCount, insertedCount, dedupedCount, failedCount };
  } catch (error) {
    await updateIngestionJob({
      jobId: job.id,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      processedCount,
      insertedCount,
      dedupedCount,
      failedCount: failedCount + 1,
      errorSummary: error?.message || String(error)
    });
    logger.error({ err: error }, 'provider_collection_worker_failed');
    return { processedCount, insertedCount, dedupedCount, failedCount: failedCount + 1 };
  }
}
