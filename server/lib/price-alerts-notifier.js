import { nanoid } from 'nanoid';
import { withDb } from './db.js';
import { logger as rootLogger } from './logger.js';
import { sendMail } from './mailer.js';
import { insertEmailDeliveryLog } from './sql-db.js';
import { getPriceAlertsStore } from './price-alerts-store.js';

const PUSH_WEBHOOK_URL = String(process.env.PUSH_WEBHOOK_URL || '').trim();
const PUSH_TIMEOUT_MS = Math.max(2000, Number(process.env.PUSH_TIMEOUT_MS || 8000));
const PUSH_RETRIES = Math.max(0, Math.min(4, Number(process.env.PUSH_RETRIES || 2)));
const PUSH_RETRY_BASE_MS = Math.max(100, Number(process.env.PUSH_RETRY_BASE_MS || 250));
const PUSH_DEAD_LETTER_MAX = Math.max(100, Number(process.env.PUSH_DEAD_LETTER_MAX || 5000));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function sanitizeChannels(channels) {
  const source = channels && typeof channels === 'object' && !Array.isArray(channels) ? channels : {};
  return {
    push: source.push !== false,
    email: source.email !== false,
    in_app: source.in_app !== false
  };
}

function buildNotificationTexts(match) {
  const price = Math.round(toNumber(match.deal_price, 0));
  const maxPrice = Math.round(toNumber(match.max_price, 0));
  const savings = Math.round(toNumber(match.savings_pct, 0));
  const route = `${match.origin_iata} -> ${match.destination_iata}`;
  const title = 'Price alert matched';
  const message = `${route}: EUR ${price} (${savings}% under baseline). Your alert max is EUR ${maxPrice}.`;
  return { title, message };
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
      if (response.ok) return { sent: true, status: response.status, reason: null };
      const retryable = response.status === 429 || (response.status >= 500 && response.status <= 599);
      if (!retryable || attempt === PUSH_RETRIES) return { sent: false, status: response.status, reason: `push_http_${response.status}` };
    } catch (error) {
      if (attempt === PUSH_RETRIES) return { sent: false, status: null, reason: error?.name === 'AbortError' ? 'push_timeout' : 'push_network_error' };
    } finally {
      clearTimeout(timer);
    }
    await sleep(PUSH_RETRY_BASE_MS * 2 ** attempt);
  }
  return { sent: false, status: null, reason: 'push_unknown_error' };
}

async function pushToDeadLetter({ withDbImpl, userId, message, metadata, reason }) {
  await withDbImpl((db) => {
    db.pushDeadLetters = db.pushDeadLetters || [];
    db.pushDeadLetters.push({
      id: nanoid(12),
      createdAt: new Date().toISOString(),
      userId,
      reason: reason || 'push_failed',
      message,
      metadata: metadata || {}
    });
    db.pushDeadLetters = db.pushDeadLetters.slice(-PUSH_DEAD_LETTER_MAX);
    return db;
  });
}

async function sendPush({ withDbImpl, userId, title, message, metadata, logger }) {
  if (!PUSH_WEBHOOK_URL) return { sent: false, skipped: true, reason: 'push_not_configured' };

  const payload = {
    userId,
    title,
    message,
    metadata: metadata || {},
    sentAt: new Date().toISOString()
  };
  const result = await pushWithRetry(payload);
  if (result.sent) return result;

  await pushToDeadLetter({
    withDbImpl,
    userId,
    message,
    metadata,
    reason: result.reason || 'push_failed'
  });
  logger.warn({ userId, reason: result.reason || 'push_failed' }, 'price_alert_push_failed_dead_lettered');
  return result;
}

async function addInAppNotification({ withDbImpl, match, title, message, metadata }) {
  const dedupeKey = `price_alert:${match.alert_id}:${match.deal_key}:in_app`;
  let created = false;
  await withDbImpl((db) => {
    db.notifications = db.notifications || [];
    if (db.notifications.some((item) => item.dedupeKey === dedupeKey)) return db;
    db.notifications.push({
      id: nanoid(12),
      userId: match.user_id,
      type: 'price_alert',
      title,
      message,
      metadata,
      dedupeKey,
      createdAt: new Date().toISOString(),
      readAt: null
    });
    db.notifications = db.notifications.slice(-5000);
    created = true;
    return db;
  });
  return { sent: created, skipped: !created, reason: created ? null : 'already_exists' };
}

async function getUserEmail(withDbImpl, userId) {
  let email = null;
  await withDbImpl((db) => {
    const user = (db.users || []).find((item) => item.id === userId) || null;
    email = user?.email ? String(user.email).trim().toLowerCase() : null;
    return null;
  });
  return email;
}

async function sendAlertEmail({ withDbImpl, mailer, logEmailDelivery, userId, title, message }) {
  const email = await getUserEmail(withDbImpl, userId);
  if (!email) return { sent: false, skipped: true, reason: 'user_email_missing' };
  try {
    const result = await mailer({
      to: email,
      subject: title,
      text: message,
      html: `<p>${message}</p>`
    });
    await logEmailDelivery({
      userId,
      email,
      subject: title,
      status: result?.sent ? 'sent' : 'skipped',
      providerMessageId: result?.messageId || null,
      errorMessage: result?.reason || null
    });
    return { sent: Boolean(result?.sent), skipped: Boolean(result?.skipped), reason: result?.reason || null };
  } catch (error) {
    await logEmailDelivery({
      userId,
      email,
      subject: title,
      status: 'failed',
      errorMessage: error?.message || 'mail_send_failed'
    });
    return { sent: false, skipped: false, reason: error?.message || 'mail_send_failed' };
  }
}

export function createPriceAlertsNotifier(options = {}) {
  const store = options.store || getPriceAlertsStore();
  const withDbImpl = options.withDb || withDb;
  const mailer = options.sendMail || sendMail;
  const logEmailDelivery = options.insertEmailDeliveryLog || insertEmailDeliveryLog;
  const logger = options.logger || rootLogger;
  const maxMatchesPerRun = Math.max(1, Math.min(5000, Number(options.maxMatchesPerRun || process.env.PRICE_ALERTS_WORKER_BATCH || 500)));

  async function runPriceAlertsScanOnce({ limit = maxMatchesPerRun } = {}) {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit || maxMatchesPerRun)));
    const cursor = await store.getWorkerCursor();
    const matchResult = await store.listMatchingDeals({ sinceObservedAt: cursor, limit: safeLimit });
    if (matchResult.skipped) {
      return {
        skipped: true,
        reason: matchResult.reason || 'source_missing',
        processed: 0,
        matched: 0,
        sentInApp: 0,
        sentEmail: 0,
        sentPush: 0,
        deduped: 0,
        failed: 0,
        cursorFrom: cursor,
        cursorTo: cursor
      };
    }

    const matches = Array.isArray(matchResult.matches) ? matchResult.matches : [];
    const checkedAlerts = new Set();
    const triggeredAlerts = new Set();
    let sentInApp = 0;
    let sentEmail = 0;
    let sentPush = 0;
    let deduped = 0;
    let failed = 0;
    let cursorTo = cursor;

    for (const match of matches) {
      checkedAlerts.add(match.alert_id);
      if (!cursorTo || (match.source_observed_at && match.source_observed_at > cursorTo)) {
        cursorTo = match.source_observed_at || cursorTo;
      }

      const channels = sanitizeChannels(match.channels);
      const { title, message } = buildNotificationTexts(match);
      const metadata = {
        alertId: match.alert_id,
        dealKey: match.deal_key,
        routeId: match.route_id,
        flightQuoteId: match.flight_quote_id,
        origin: match.origin_iata,
        destination: match.destination_iata,
        departureDate: match.departure_date,
        returnDate: match.return_date,
        tripType: match.trip_type,
        price: match.deal_price,
        maxPrice: match.max_price,
        savingsPct: match.savings_pct,
        finalScore: match.final_score
      };

      if (channels.in_app) {
        const claimed = await store.claimDelivery({ alertId: match.alert_id, userId: match.user_id, dealKey: match.deal_key, channel: 'in_app' });
        if (!claimed) {
          deduped += 1;
        } else {
          const result = await addInAppNotification({ withDbImpl, match, title, message, metadata });
          if (result.sent) {
            sentInApp += 1;
            triggeredAlerts.add(match.alert_id);
          } else if (!result.skipped) {
            failed += 1;
          }
        }
      }

      if (channels.email) {
        const claimed = await store.claimDelivery({ alertId: match.alert_id, userId: match.user_id, dealKey: match.deal_key, channel: 'email' });
        if (!claimed) {
          deduped += 1;
        } else {
          const result = await sendAlertEmail({
            withDbImpl,
            mailer,
            logEmailDelivery,
            userId: match.user_id,
            title,
            message
          });
          if (result.sent) {
            sentEmail += 1;
            triggeredAlerts.add(match.alert_id);
          } else if (!result.skipped) {
            failed += 1;
          }
        }
      }

      if (channels.push) {
        const claimed = await store.claimDelivery({ alertId: match.alert_id, userId: match.user_id, dealKey: match.deal_key, channel: 'push' });
        if (!claimed) {
          deduped += 1;
        } else {
          const result = await sendPush({
            withDbImpl,
            userId: match.user_id,
            title,
            message,
            metadata,
            logger
          });
          if (result.sent) {
            sentPush += 1;
            triggeredAlerts.add(match.alert_id);
          } else if (!result.skipped) {
            failed += 1;
          }
        }
      }
    }

    const checkedAt = new Date().toISOString();
    await store.markAlertsChecked([...checkedAlerts], checkedAt);
    await store.markAlertsTriggered([...triggeredAlerts], checkedAt);
    if (cursorTo && cursorTo !== cursor) {
      await store.setWorkerCursor(cursorTo);
    }

    const summary = {
      skipped: false,
      reason: null,
      processed: matches.length,
      matched: matches.length,
      sentInApp,
      sentEmail,
      sentPush,
      deduped,
      failed,
      cursorFrom: cursor,
      cursorTo: cursorTo || cursor,
      checkedAlerts: checkedAlerts.size,
      triggeredAlerts: triggeredAlerts.size
    };

    logger.info(summary, 'price_alerts_scan_completed');
    return summary;
  }

  return {
    runPriceAlertsScanOnce
  };
}

let singleton = null;

export function getPriceAlertsNotifier() {
  if (!singleton) singleton = createPriceAlertsNotifier();
  return singleton;
}

export async function runPriceAlertsScanOnce(options = {}) {
  return getPriceAlertsNotifier().runPriceAlertsScanOnce(options);
}
