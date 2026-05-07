import { withDb as defaultWithDb } from '../lib/db.js';
import { sendMail as defaultSendMail } from '../lib/mailer.js';
import { logger as defaultLogger } from '../lib/logger.js';
import { resolveUserPlan } from '../lib/plan-access.js';
import { canSendEmailType } from '../lib/email/email-preferences.js';
import { digestCadenceForPlan, getEmailLimits } from '../lib/email/email-limits.js';
import { routeDigestTemplate } from '../lib/email/email-templates.js';
import {
  recordEmailAttempt,
  recordEmailSent,
  recordEmailSkipped
} from '../lib/email/email-metrics.js';

const DEFAULT_BATCH_LIMIT = 100;

function currentPeriodKey(planType, now) {
  const date = now instanceof Date ? now : new Date(now || Date.now());
  const year = date.getUTCFullYear();
  const day = Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 1)) / 86400000) + 1;
  if (planType === 'free') {
    return `${year}-w${Math.ceil(day / 7)}`;
  }
  return date.toISOString().slice(0, 10);
}

function defaultListCachedPublicDeals(db, { limit = 10 } = {}) {
  const source = Array.isArray(db?.publicDeals) ? db.publicDeals : Array.isArray(db?.detectedDeals) ? db.detectedDeals : [];
  return source
    .filter((deal) => deal && (deal.dataSource === 'cached_public_scan' || deal.source === 'cached_public_scan' || deal.public === true))
    .slice(0, Math.max(1, Math.min(25, Number(limit || 10))))
    .map((deal) => ({
      route: deal.route || `${deal.origin || deal.origin_iata || ''}-${deal.destination || deal.destination_iata || ''}`.replace(/^-|-$/g, ''),
      price: deal.price || deal.total_price || deal.deal_price || null,
      currency: deal.currency || 'EUR',
      dataSource: 'cached_public_scan'
    }));
}

function alreadyDelivered(db, key) {
  db.emailDigestDeliveries = Array.isArray(db.emailDigestDeliveries) ? db.emailDigestDeliveries : [];
  return db.emailDigestDeliveries.some((item) => item.idempotencyKey === key);
}

function markDelivered(db, { key, userId, planType, at }) {
  db.emailDigestDeliveries = Array.isArray(db.emailDigestDeliveries) ? db.emailDigestDeliveries : [];
  db.emailDigestDeliveries.push({
    idempotencyKey: key,
    userId,
    planType,
    deliveredAt: at
  });
  db.emailDigestDeliveries = db.emailDigestDeliveries.slice(-5000);
}

export function createEmailDigestWorker({
  withDb = defaultWithDb,
  sendMail = defaultSendMail,
  listCachedPublicDeals = defaultListCachedPublicDeals,
  logger = defaultLogger,
  now = () => new Date(),
  batchLimit = DEFAULT_BATCH_LIMIT
} = {}) {
  async function runEmailDigestOnce() {
    const at = now();
    const safeBatchLimit = Math.max(1, Math.min(500, Number(batchLimit || DEFAULT_BATCH_LIMIT)));
    const pending = [];
    let skippedPreferences = 0;
    let skippedNoValue = 0;
    let skippedDuplicate = 0;

    await withDb((db) => {
      const users = Array.isArray(db.users) ? db.users.slice(0, safeBatchLimit) : [];
      for (const user of users) {
        const { planType } = resolveUserPlan(user);
        const cadence = digestCadenceForPlan(planType);
        const limits = getEmailLimits(planType);
        if (cadence === 'none' || (!limits.weeklyDigest && !limits.dailyDigest)) continue;
        if (!user?.email || !canSendEmailType(user, 'digest')) {
          skippedPreferences += 1;
          recordEmailSkipped('preferences');
          continue;
        }

        const idempotencyKey = `digest:${planType}:${user.id}:${currentPeriodKey(planType, at)}`;
        if (alreadyDelivered(db, idempotencyKey)) {
          skippedDuplicate += 1;
          continue;
        }

        const deals = listCachedPublicDeals(db, { user, planType, limit: planType === 'free' ? 10 : 25 });
        if (!Array.isArray(deals) || deals.length === 0) {
          skippedNoValue += 1;
          recordEmailSkipped('no_value');
          continue;
        }

        pending.push({ user, planType, idempotencyKey, deals: deals.slice(0, planType === 'free' ? 10 : 25) });
      }
      return db;
    });

    let sent = 0;
    let skippedNotReady = 0;
    for (const item of pending) {
      const template = routeDigestTemplate({
        user: item.user,
        plan: item.planType,
        deals: item.deals,
        managePreferencesUrl: item.user.managePreferencesUrl,
        privacyUrl: item.user.privacyUrl
      });
      recordEmailAttempt(item.planType);
      const result = await sendMail({
        to: item.user.email,
        subject: template.subject,
        text: template.text,
        html: template.html,
        type: 'digest',
        plan: item.planType
      });
      if (result?.sent) {
        sent += 1;
        recordEmailSent(item.planType);
        await withDb((db) => {
          markDelivered(db, {
            key: item.idempotencyKey,
            userId: item.user.id,
            planType: item.planType,
            at: new Date(at).toISOString()
          });
          return db;
        });
      } else if (result?.reason === 'email_not_configured' || result?.reason === 'email_dry_run') {
        skippedNotReady += 1;
        recordEmailSkipped('not_ready');
      }
    }

    const summary = {
      processed: pending.length,
      sent,
      skippedPreferences,
      skippedNoValue,
      skippedDuplicate,
      skippedNotReady
    };
    logger.info(summary, 'email_digest_worker_completed');
    return summary;
  }

  return { runEmailDigestOnce };
}

export async function runEmailDigestWorkerOnce(options = {}) {
  return createEmailDigestWorker(options).runEmailDigestOnce();
}
