import { nanoid } from 'nanoid';
import {
  claimDiscoveryDedupe,
  getDiscoveryWorkerCursor,
  initDealEngineStore,
  listActiveDiscoverySubscriptions,
  listPriceObservationsSince,
  scoreDeal,
  setDiscoveryWorkerCursor
} from '../lib/deal-engine-store.js';
import { getDestinationMeta } from '../lib/discovery-engine.js';
import { withDb } from '../lib/db.js';
import { appendImmutableAudit } from '../lib/audit-log.js';
import { logger } from '../lib/logger.js';

function inDateWindow(dateText, from, to) {
  const v = String(dateText).slice(0, 10);
  return v >= String(from).slice(0, 10) && v <= String(to).slice(0, 10);
}

function matchRegion(subscriptionRegion, destinationRegion) {
  const wanted = String(subscriptionRegion || 'all').toLowerCase();
  if (wanted === 'all') return true;
  return wanted === String(destinationRegion || 'all').toLowerCase();
}

function shortMessage({ destination, price }) {
  return `Hot deal: ${destination} at EUR ${Number(price).toFixed(0)}. Jump on it.`;
}

export async function runDiscoveryAlertWorkerOnce({ limit = 500 } = {}) {
  await initDealEngineStore();
  const cursor = await getDiscoveryWorkerCursor();
  const observations = await listPriceObservationsSince({ observedAfter: cursor, limit });
  if (!observations.length) return { processed: 0, triggered: 0 };

  const subscriptions = await listActiveDiscoverySubscriptions();
  let triggered = 0;
  let processed = 0;

  for (const obs of observations) {
    processed += 1;
    const destinationMeta = await getDestinationMeta(obs.destination_iata);
    for (const sub of subscriptions) {
      if (String(sub.origin_iata || '').toUpperCase() !== String(obs.origin_iata || '').toUpperCase()) continue;
      if (!inDateWindow(obs.departure_date, sub.date_from, sub.date_to)) continue;
      if (!matchRegion(sub.region, destinationMeta?.region)) continue;
      if (Number(obs.total_price) > Number(sub.budget_eur)) continue;

      const score = await scoreDeal({
        origin: obs.origin_iata,
        destination: obs.destination_iata,
        departureDate: String(obs.departure_date).slice(0, 10),
        price: Number(obs.total_price)
      });
      if (!['great', 'scream'].includes(String(score.dealLevel || '').toLowerCase())) continue;

      const dedupeKey = `discovery:${sub.id}:${obs.fingerprint}`;
      const firstTime = await claimDiscoveryDedupe({
        dedupeKey,
        userId: sub.user_id,
        subscriptionId: sub.id,
        observationFingerprint: obs.fingerprint
      });
      if (!firstTime) continue;

      const msg = shortMessage({ destination: obs.destination_iata, price: obs.total_price });
      await withDb((db) => {
        db.notifications = db.notifications || [];
        if (db.notifications.some((n) => n.dedupeKey === dedupeKey)) return db;
        db.notifications.push({
          id: nanoid(12),
          type: 'discovery_alert',
          dedupeKey,
          userId: sub.user_id,
          subscriptionId: sub.id,
          createdAt: new Date().toISOString(),
          message: msg,
          metadata: {
            dealLevel: score.dealLevel,
            dealScore: score.dealScore,
            price: Number(obs.total_price),
            origin: obs.origin_iata,
            destination: obs.destination_iata,
            departureDate: String(obs.departure_date).slice(0, 10)
          }
        });
        db.notifications = db.notifications.slice(-3000);
        return db;
      });

      appendImmutableAudit({
        category: 'discovery_alert_worker',
        type: 'notification_triggered',
        success: true,
        detail: `subscription=${sub.id}; user=${sub.user_id}; fp=${obs.fingerprint}; level=${score.dealLevel}`
      }).catch(() => {});
      triggered += 1;
    }
  }

  const lastObservedAt = observations[observations.length - 1]?.observed_at;
  if (lastObservedAt) await setDiscoveryWorkerCursor(lastObservedAt);
  logger.info({ processed, triggered, from: cursor, to: lastObservedAt || null }, 'discovery_alert_worker_completed');
  return { processed, triggered };
}

