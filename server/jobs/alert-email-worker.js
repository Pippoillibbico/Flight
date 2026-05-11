import { withDb as defaultWithDb } from '../lib/db.js';
import { sendMail as defaultSendMail } from '../lib/mailer.js';
import { logger as defaultLogger } from '../lib/logger.js';
import { resolveUserPlan } from '../lib/plan-access.js';
import { canSendEmailType } from '../lib/email/email-preferences.js';
import { canSendInstantAlertForPlan } from '../lib/email/email-limits.js';
import { priceAlertTemplate } from '../lib/email/email-templates.js';
import { buildUnsubscribeUrl } from '../lib/email/unsubscribe-token.js';
import { getEmailReadiness } from '../lib/email/email-readiness.js';
import {
  recordEmailAttempt,
  recordEmailSent,
  recordEmailSkipped
} from '../lib/email/email-metrics.js';

function ensureDeliveryStore(db) {
  db.emailAlertDeliveries = Array.isArray(db.emailAlertDeliveries) ? db.emailAlertDeliveries : [];
  return db.emailAlertDeliveries;
}

function defaultIdempotencyKey({ user, alert, deal }) {
  return [
    'alert-email',
    user?.id || alert?.userId || 'unknown',
    alert?.id || 'alert',
    deal?.dealKey || deal?.id || deal?.route || deal?.destination || 'deal'
  ].join(':');
}

export function createAlertEmailWorker({
  withDb = defaultWithDb,
  sendMail = defaultSendMail,
  logger = defaultLogger,
  emailReadiness = () => getEmailReadiness(process.env),
  providerReady = false
} = {}) {
  async function sendPriceAlertEmail({ user, alert, deal, idempotencyKey = defaultIdempotencyKey({ user, alert, deal }) }) {
    const { planType } = resolveUserPlan(user);
    if (planType === 'free' || !canSendInstantAlertForPlan(planType)) {
      recordEmailSkipped('not_ready');
      return { sent: false, skipped: true, reason: 'free_instant_alerts_disabled' };
    }
    if (planType === 'elite' && !providerReady) {
      recordEmailSkipped('not_ready');
      return { sent: false, skipped: true, reason: 'provider_not_ready_for_elite_alert' };
    }
    if (!user?.email || !canSendEmailType(user, 'alert')) {
      recordEmailSkipped('preferences');
      return { sent: false, skipped: true, reason: 'email_preferences_disabled' };
    }

    const readiness = emailReadiness();
    if (readiness.status !== 'EMAIL_READY') {
      recordEmailSkipped('not_ready');
      return { sent: false, skipped: true, reason: readiness.status };
    }

    let duplicate = false;
    await withDb((db) => {
      const deliveries = ensureDeliveryStore(db);
      duplicate = deliveries.some((item) => item.idempotencyKey === idempotencyKey);
      return db;
    });
    if (duplicate) return { sent: false, skipped: true, reason: 'duplicate_alert_email' };

    const template = priceAlertTemplate({
      user,
      plan: planType,
      deal,
      providerReady: Boolean(providerReady),
      managePreferencesUrl: user.managePreferencesUrl,
      privacyUrl: user.privacyUrl,
      unsubscribeUrl: buildUnsubscribeUrl({ userId: user.id, type: 'alert' })
    });

    recordEmailAttempt(planType);
    const result = await sendMail({
      to: user.email,
      subject: template.subject,
      text: template.text,
      html: template.html,
      type: 'alert',
      plan: planType
    });

    if (!result?.sent) {
      if (result?.skipped) recordEmailSkipped('not_ready');
      return { sent: false, skipped: Boolean(result?.skipped), reason: result?.reason || 'email_delivery_failed' };
    }

    await withDb((db) => {
      const deliveries = ensureDeliveryStore(db);
      deliveries.push({
        idempotencyKey,
        userId: user.id,
        alertId: alert?.id || null,
        dealKey: deal?.dealKey || deal?.id || null,
        planType,
        deliveredAt: new Date().toISOString()
      });
      db.emailAlertDeliveries = deliveries.slice(-10000);
      return db;
    });

    recordEmailSent(planType);
    return { sent: true, skipped: false, reason: null };
  }

  async function runAlertEmailBatch({ items = [] } = {}) {
    let sent = 0;
    let skipped = 0;
    for (const item of items) {
      const result = await sendPriceAlertEmail(item);
      if (result.sent) sent += 1;
      else if (result.skipped) skipped += 1;
    }
    const summary = { processed: items.length, sent, skipped };
    logger.info(summary, 'alert_email_worker_completed');
    return summary;
  }

  return { sendPriceAlertEmail, runAlertEmailBatch };
}

export async function runAlertEmailWorkerOnce(options = {}) {
  return createAlertEmailWorker(options).runAlertEmailBatch(options);
}
