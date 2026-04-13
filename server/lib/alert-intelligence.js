import { nanoid } from 'nanoid';
import { z } from 'zod';
import { detectDeal } from './deal-detector.js';
import { readDb, withDb } from './db.js';
import { sendMail } from './mailer.js';
import { logger } from './logger.js';
import { appendImmutableAudit } from './audit-log.js';

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

const PUSH_WEBHOOK_URL = String(process.env.PUSH_WEBHOOK_URL || '').trim();
const PUSH_TIMEOUT_MS = Math.max(2000, Number(process.env.PUSH_TIMEOUT_MS || 8000));
const PUSH_RETRIES = Math.max(0, Math.min(4, Number(process.env.PUSH_RETRIES || 2)));
const PUSH_RETRY_BASE_MS = Math.max(100, Number(process.env.PUSH_RETRY_BASE_MS || 250));
const PUSH_DEAD_LETTER_MAX = Math.max(100, Number(process.env.PUSH_DEAD_LETTER_MAX || 5000));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pushWithRetry(payload) {
  for (let attempt = 0; attempt <= PUSH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
    try {
      const response = await fetch(PUSH_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.PUSH_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.PUSH_WEBHOOK_TOKEN}` } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (response.ok) return { sent: true, status: response.status };
      const retryable = response.status === 429 || (response.status >= 500 && response.status <= 599);
      if (!retryable || attempt === PUSH_RETRIES) {
        return { sent: false, status: response.status, reason: `push_http_${response.status}` };
      }
    } catch (error) {
      if (attempt === PUSH_RETRIES) {
        return { sent: false, status: null, reason: error?.name === 'AbortError' ? 'push_timeout' : 'push_network_error' };
      }
    } finally {
      clearTimeout(timer);
    }
    await sleep(PUSH_RETRY_BASE_MS * 2 ** attempt);
  }
  return { sent: false, status: null, reason: 'push_unknown_error' };
}

async function pushToDeadLetter(entry) {
  await withDb((db) => {
    db.pushDeadLetters = db.pushDeadLetters || [];
    db.pushDeadLetters.push({
      id: nanoid(12),
      createdAt: new Date().toISOString(),
      ...entry
    });
    db.pushDeadLetters = db.pushDeadLetters.slice(-PUSH_DEAD_LETTER_MAX);
    return db;
  });
}

async function sendPushNotification({ userId, message, metadata }) {
  if (!PUSH_WEBHOOK_URL) {
    return { sent: false, skipped: true, reason: 'push_not_configured' };
  }

  const payload = {
    userId,
    title: 'Flight deal alert',
    message,
    metadata: metadata || {},
    sentAt: new Date().toISOString()
  };
  const result = await pushWithRetry(payload);
  if (result.sent) {
    appendImmutableAudit({
      category: 'push_notification',
      type: 'send_success',
      success: true,
      userId,
      detail: `status=${result.status || 200}`
    }).catch(() => {});
    return result;
  }

  await pushToDeadLetter({
    userId,
    reason: result.reason || 'push_failed',
    message,
    metadata: metadata || {}
  }).catch(() => {});
  appendImmutableAudit({
    category: 'push_notification',
    type: 'send_failed_dead_lettered',
    success: false,
    userId,
    detail: result.reason || 'push_failed'
  }).catch(() => {});
  logger.warn({ userId, reason: result.reason, metadata }, 'push_notification_failed_dead_lettered');
  return result;
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
