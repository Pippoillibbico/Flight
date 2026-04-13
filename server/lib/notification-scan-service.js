import { createHash } from 'node:crypto';
import { addDays, format, parseISO } from 'date-fns';
import { findCheapestWindows } from './window-finder-engine.js';

function toSafeInt(value, { fallback, min, max }) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

export function notifyScanDateWindow(subscription) {
  const safeOffset = toSafeInt(subscription?.daysFromNow, { fallback: 14, min: 1, max: 365 });
  const safeStayDays = toSafeInt(subscription?.stayDays, { fallback: 7, min: 1, max: 30 });
  const start = addDays(new Date(), safeOffset);
  const end = addDays(start, safeStayDays);
  return {
    dateFrom: format(start, 'yyyy-MM-dd'),
    dateTo: format(end, 'yyyy-MM-dd')
  };
}

function stableSubscriptionScanKey(subscription) {
  const normalized = {
    id: String(subscription?.id || ''),
    origin: String(subscription?.origin || '').toUpperCase(),
    region: String(subscription?.region || 'all').toLowerCase(),
    country: String(subscription?.country || '').toLowerCase(),
    destinationQuery: String(subscription?.destinationQuery || '').toLowerCase(),
    destinationIata: String(subscription?.destinationIata || '').toUpperCase(),
    connectionType: String(subscription?.connectionType || 'all'),
    maxStops: Number.isFinite(Number(subscription?.maxStops)) ? Number(subscription.maxStops) : null,
    travelTime: String(subscription?.travelTime || 'all'),
    minComfortScore: Number.isFinite(Number(subscription?.minComfortScore)) ? Number(subscription.minComfortScore) : null,
    travellers: Number(subscription?.travellers || 1),
    cabinClass: String(subscription?.cabinClass || 'economy'),
    stayDays: Number(subscription?.stayDays || 7),
    cheapOnly: Boolean(subscription?.cheapOnly)
  };
  return createHash('sha1').update(JSON.stringify(normalized)).digest('hex');
}

async function readBestWindowFromCache(cache, key) {
  try {
    const cached = await cache.get(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeBestWindowToCache(cache, key, ttlSec, payload) {
  try {
    await cache.setex(key, ttlSec, JSON.stringify(payload));
  } catch {
    // best effort cache write
  }
}

async function findCheapestWindowForSubscription(subscription, { cache, scanCacheTtlSec }) {
  const safeStayDays = toSafeInt(subscription?.stayDays, { fallback: 7, min: 1, max: 30 });
  const start = addDays(new Date(), 1);
  const end = addDays(start, 365);
  const dateFrom = format(start, 'yyyy-MM-dd');
  const dateTo = format(end, 'yyyy-MM-dd');
  const cacheKey = `alerts:scan:best_window:${stableSubscriptionScanKey(subscription)}:${format(new Date(), 'yyyy-MM-dd')}`;

  const cached = await readBestWindowFromCache(cache, cacheKey);
  if (cached) return cached;

  const windowResult = findCheapestWindows({
    origin: subscription.origin,
    dateFrom,
    dateTo,
    stayDays: safeStayDays,
    destinationQuery: subscription.destinationQuery || '',
    region: subscription.region || 'all',
    maxBudget: undefined,
    travellers: Number(subscription.travellers || 1),
    cabinClass: subscription.cabinClass || 'economy',
    topN: 80
  });

  let candidates = Array.isArray(windowResult?.windows) ? windowResult.windows : [];
  if (subscription.destinationIata) {
    const wanted = String(subscription.destinationIata || '').toUpperCase();
    candidates = candidates.filter((flight) => String(flight.destinationIata || '').toUpperCase() === wanted);
  }
  if (subscription.connectionType === 'direct') candidates = candidates.filter((flight) => Number(flight.stopCount || 0) === 0);
  if (subscription.connectionType === 'with_stops') candidates = candidates.filter((flight) => Number(flight.stopCount || 0) > 0);
  if (Number.isFinite(Number(subscription.maxStops))) {
    const safeMaxStops = Number(subscription.maxStops);
    candidates = candidates.filter((flight) => Number(flight.stopCount || 0) <= safeMaxStops);
  }
  if (subscription.travelTime === 'day') candidates = candidates.filter((flight) => !flight.isNightFlight);
  if (subscription.travelTime === 'night') candidates = candidates.filter((flight) => Boolean(flight.isNightFlight));
  if (Number.isFinite(Number(subscription.minComfortScore))) {
    const minComfort = Number(subscription.minComfortScore);
    candidates = candidates.filter((flight) => Number(flight.comfortScore || 0) >= minComfort);
  }
  if (subscription.cheapOnly) candidates = candidates.filter((flight) => Number(flight.savingVs2024 || 0) > 0);

  const best = candidates
    .slice()
    .sort((a, b) => Number(a.price || 0) - Number(b.price || 0) || Number(b.savingVs2024 || 0) - Number(a.savingVs2024 || 0))[0];

  if (!best) return null;

  const normalized = {
    origin: String(best.origin || subscription.origin || '').toUpperCase(),
    destination: String(best.destination || '').trim(),
    destinationIata: String(best.destinationIata || '').toUpperCase(),
    price: Number(best.price || 0),
    dateFrom: String(best.dateFrom || ''),
    dateTo: String(best.dateTo || ''),
    link: best.link || null
  };

  await writeBestWindowToCache(cache, cacheKey, scanCacheTtlSec, normalized);
  return normalized;
}

async function sendPendingEmails({ items, sendMail, insertEmailDeliveryLog }) {
  for (const item of items) {
    try {
      const result = await sendMail({
        to: item.email,
        subject: item.subject,
        text: item.text,
        html: `<p>${item.text}</p>`
      });
      await insertEmailDeliveryLog({
        userId: item.userId,
        email: item.email,
        subject: item.subject,
        status: result.sent ? 'sent' : 'skipped',
        providerMessageId: result.messageId || null,
        errorMessage: result.reason || null
      });
    } catch (error) {
      await insertEmailDeliveryLog({
        userId: item.userId,
        email: item.email,
        subject: item.subject,
        status: 'failed',
        errorMessage: error?.message || 'mail_send_failed'
      });
    }
  }
}

export function createNotificationScanService({
  withDb,
  searchFlights,
  sendMail,
  insertEmailDeliveryLog,
  getCacheClient,
  logger,
  nanoid,
  scanCacheTtlSec,
  scanLockTtlSec
}) {
  const safeScanCacheTtlSec = Math.max(60, Number(scanCacheTtlSec || 900));
  const safeScanLockTtlSec = Math.max(30, Number(scanLockTtlSec || 300));

  async function scanSubscriptionsOnce() {
    const cache = getCacheClient();
    const lockKey = 'jobs:notifications_scan:lock';
    let lockAcquired = true;

    if (typeof cache.setnx === 'function') {
      try {
        lockAcquired = Boolean(await cache.setnx(lockKey, String(Date.now()), safeScanLockTtlSec));
      } catch {
        lockAcquired = true;
      }
    }

    if (!lockAcquired) {
      logger.info({ lockKey }, 'notifications_scan_skipped_lock_exists');
      return { skipped: true, reason: 'lock_exists' };
    }

    const pendingEmails = [];

    try {
      await withDb(async (db) => {
        const todayTag = format(new Date(), 'yyyy-MM-dd');

        for (const subscription of db.alertSubscriptions) {
          if (!subscription.enabled) continue;

          const smartDurationMode = !Number.isFinite(subscription.targetPrice) || subscription.scanMode === 'duration_auto';
          if (smartDurationMode) {
            const best = await findCheapestWindowForSubscription(subscription, { cache, scanCacheTtlSec: safeScanCacheTtlSec });
            if (!best) continue;

            const departure = parseISO(best.dateFrom);
            const monthLabel = Number.isNaN(departure.getTime()) ? String(best.dateFrom || '') : format(departure, 'MMMM yyyy');
            const dedupeKey = `${subscription.id}:smart:${best.destinationIata}:${best.dateFrom}:${best.dateTo}:${best.price}`;
            const alreadySent = db.notifications.some((n) => n.dedupeKey === dedupeKey);
            if (alreadySent) continue;

            db.notifications.push({
              id: nanoid(12),
              dedupeKey,
              userId: subscription.userId,
              subscriptionId: subscription.id,
              createdAt: new Date().toISOString(),
              readAt: null,
              title: '\u26A1 Opportunita rara trovata',
              message: `${best.origin} -> ${best.destination}\n${Math.round(Number(best.price || 0))}\u20AC\nFinestra consigliata: ${monthLabel}.`,
              data: {
                origin: best.origin,
                destination: best.destination,
                destinationIata: best.destinationIata,
                price: best.price,
                targetPrice: null,
                dateFrom: best.dateFrom,
                dateTo: best.dateTo,
                link: best.link
              }
            });

            const user = db.users.find((u) => u.id === subscription.userId);
            if (user?.email) {
              pendingEmails.push({
                userId: user.id,
                email: user.email,
                subject: '\u26A1 Opportunita rara trovata',
                text: `${best.origin} -> ${best.destination}\n${Math.round(Number(best.price || 0))}\u20AC\nFinestra consigliata: ${monthLabel}.\nQuesto volo potrebbe sparire presto.`
              });
            }
            continue;
          }

          const { dateFrom, dateTo } = notifyScanDateWindow(subscription);
          const result = searchFlights({
            origin: subscription.origin,
            region: subscription.region,
            country: subscription.country,
            destinationQuery: subscription.destinationQuery,
            dateFrom,
            dateTo,
            cheapOnly: subscription.cheapOnly,
            maxBudget: subscription.targetPrice,
            connectionType: subscription.connectionType || 'all',
            maxStops: subscription.maxStops,
            travelTime: subscription.travelTime || 'all',
            minComfortScore: subscription.minComfortScore,
            travellers: subscription.travellers,
            cabinClass: subscription.cabinClass
          });

          let candidates = result.flights;
          if (subscription.destinationIata) {
            candidates = candidates.filter((flight) => flight.destinationIata === subscription.destinationIata);
          }

          const best = candidates[0];
          if (!best || best.price > subscription.targetPrice) continue;

          const dedupeKey = `${subscription.id}:${best.destinationIata}:${dateFrom}:${dateTo}:${todayTag}`;
          const alreadySent = db.notifications.some((n) => n.dedupeKey === dedupeKey);
          if (alreadySent) continue;

          db.notifications.push({
            id: nanoid(12),
            dedupeKey,
            userId: subscription.userId,
            subscriptionId: subscription.id,
            createdAt: new Date().toISOString(),
            readAt: null,
            title: '\uD83D\uDD25 Nuova occasione',
            message: `${best.origin} -> ${best.destination}\n${Math.round(Number(best.price || 0))}\u20AC\nTarget radar: ${Math.round(Number(subscription.targetPrice || 0))}\u20AC.`,
            data: {
              origin: best.origin,
              destination: best.destination,
              destinationIata: best.destinationIata,
              price: best.price,
              targetPrice: subscription.targetPrice,
              dateFrom,
              dateTo,
              link: best.link
            }
          });

          const user = db.users.find((u) => u.id === subscription.userId);
          if (user?.email) {
            pendingEmails.push({
              userId: user.id,
              email: user.email,
              subject: '\uD83D\uDD25 Nuova occasione',
              text: `${best.origin} -> ${best.destination}\n${Math.round(Number(best.price || 0))}\u20AC\nTarget radar: ${Math.round(Number(subscription.targetPrice || 0))}\u20AC.\nQuesto volo potrebbe sparire presto.`
            });
          }
        }

        db.notifications = db.notifications.slice(-2000);
        return db;
      });

      await sendPendingEmails({ items: pendingEmails, sendMail, insertEmailDeliveryLog });
    } finally {
      try {
        await cache.del(lockKey);
      } catch {
        // best effort lock release
      }
    }

    return { processedEmails: pendingEmails.length };
  }

  return {
    scanSubscriptionsOnce
  };
}
