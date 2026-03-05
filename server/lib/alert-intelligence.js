import { nanoid } from 'nanoid';
import { z } from 'zod';
import { detectDeal } from './deal-detector.js';
import { readDb, withDb } from './db.js';
import { sendMail } from './mailer.js';
import { logger } from './logger.js';

/**
 * @typedef {Object} AlertObservation
 * @property {string} origin
 * @property {string} destination
 * @property {string} date
 * @property {number} price
 * @property {string} fingerprint
 * @property {string=} observedAt
 */

const observationSchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.number().positive(),
  fingerprint: z.string().trim().min(20),
  observedAt: z.string().datetime().optional()
});

function shortDealMessage({ destination, price, dealType }) {
  if (dealType === 'error_fare') return `Error fare spotted to ${destination}: EUR ${Math.round(price)}. Act fast.`;
  if (dealType === 'flash_sale') return `Flash sale to ${destination}: EUR ${Math.round(price)} right now.`;
  return `Great deal to ${destination}: EUR ${Math.round(price)}.`;
}

async function sendPushNotification({ userId, message, metadata }) {
  logger.info({ userId, message, metadata }, 'push_notification_stub');
  return { sent: false, reason: 'push_not_configured' };
}

async function loadDiscoverySubs() {
  const db = await readDb();
  return (db.alertSubscriptions || []).filter((s) => s.enabled);
}

async function claimAlertDedupe(dedupeKey) {
  let claimed = false;
  await withDb((db) => {
    const seen = new Set((db.alertIntelligenceDedupe || []).map((d) => d.key));
    if (seen.has(dedupeKey)) return null;
    db.alertIntelligenceDedupe = db.alertIntelligenceDedupe || [];
    db.alertIntelligenceDedupe.push({ id: nanoid(12), key: dedupeKey, createdAt: new Date().toISOString() });
    db.alertIntelligenceDedupe = db.alertIntelligenceDedupe.slice(-100000);
    claimed = true;
    return db;
  });
  return claimed;
}

async function notifyDashboard({ userId, message, metadata, dedupeKey }) {
  await withDb((db) => {
    db.notifications = db.notifications || [];
    if (db.notifications.some((n) => n.dedupeKey === dedupeKey)) return db;
    db.notifications.push({
      id: nanoid(12),
      userId,
      type: 'intelligence_alert',
      title: 'New deal found',
      message,
      metadata,
      dedupeKey,
      createdAt: new Date().toISOString(),
      readAt: null
    });
    db.notifications = db.notifications.slice(-4000);
    return db;
  });
}

export async function evaluateObservationForAlerts(observation, { threshold = 70, deviationThresholdPct = 35 } = {}) {
  const obs = observationSchema.parse(observation);
  try {
    const deal = await detectDeal({
      origin: obs.origin,
      destination: obs.destination,
      date: obs.date,
      price: obs.price
    });
    const dropPct = Math.max(0, -Number(deal.deviation?.percent || 0));
    if (Number(deal.deal_score || 0) < threshold || dropPct < deviationThresholdPct) {
      return { triggered: 0, skipped: true, reason: 'below_threshold', deal };
    }

    const subscriptions = await loadDiscoverySubs();
    const relevant = subscriptions.filter((s) => {
      const originOk = String(s.origin || '').toUpperCase() === String(obs.origin).toUpperCase();
      const destinationOk = !s.destinationIata || String(s.destinationIata).toUpperCase() === String(obs.destination).toUpperCase();
      const budgetOk = Number.isFinite(s.targetPrice) ? Number(obs.price) <= Number(s.targetPrice) : true;
      return originOk && destinationOk && budgetOk;
    });

    let triggered = 0;
    for (const sub of relevant) {
      const dedupeKey = `intelligence:${sub.id}:${obs.fingerprint}`;
      const claimed = await claimAlertDedupe(dedupeKey);
      if (!claimed) continue;

      const message = shortDealMessage({
        destination: obs.destination,
        price: obs.price,
        dealType: deal.deal_type
      });
      const metadata = {
        origin: obs.origin,
        destination: obs.destination,
        price: obs.price,
        date: obs.date,
        deal_score: deal.deal_score,
        deal_type: deal.deal_type,
        deviation_pct: dropPct
      };

      await notifyDashboard({ userId: sub.userId, message, metadata, dedupeKey });

      const db = await readDb();
      const user = (db.users || []).find((u) => u.id === sub.userId);
      if (user?.email) {
        try {
          await sendMail({
            to: user.email,
            subject: 'Flight deal alert',
            text: message,
            html: `<p>${message}</p>`
          });
        } catch (error) {
          logger.warn({ err: error, userId: sub.userId }, 'alert_email_send_failed');
        }
      }

      await sendPushNotification({ userId: sub.userId, message, metadata }).catch(() => {});
      triggered += 1;
    }
    return { triggered, skipped: false, deal };
  } catch (error) {
    logger.error({ err: error, observation: obs }, 'evaluate_observation_for_alerts_failed');
    throw error;
  }
}
