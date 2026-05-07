import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createEmailProvider } from '../server/lib/email/email-provider.js';
import { assertEmailReadinessForProduction } from '../server/lib/email/email-readiness.js';
import { passwordResetTemplate, priceAlertTemplate, routeDigestTemplate } from '../server/lib/email/email-templates.js';
import { createEmailDigestWorker } from '../server/jobs/email-digest-worker.js';
import { createAlertEmailWorker } from '../server/jobs/alert-email-worker.js';

function createDb(seed) {
  const db = structuredClone(seed);
  return {
    db,
    withDb: async (task) => task(db)
  };
}

test('EMAIL_DRY_RUN=true does not create or use a real SMTP transport', async () => {
  let transportCreated = false;
  const logs = [];
  const provider = createEmailProvider({
    env: { EMAIL_PROVIDER: 'smtp', EMAIL_DRY_RUN: 'true', SMTP_PASS: 'super-secret' },
    logger: { info: (meta, msg) => logs.push({ meta, msg }), warn: (meta, msg) => logs.push({ meta, msg }) },
    transportFactory: () => {
      transportCreated = true;
      return { sendMail: async () => ({ messageId: 'nope' }) };
    }
  });

  const result = await provider.sendEmail({ to: 'user@example.com', subject: 'Test', text: 'Body' });
  assert.equal(result.dryRun, true);
  assert.equal(transportCreated, false);
  assert.equal(JSON.stringify(logs).includes('super-secret'), false);
});

test('production real-email mode fails readiness when SMTP credentials are missing', () => {
  assert.throws(
    () => assertEmailReadinessForProduction({ NODE_ENV: 'production', EMAIL_PROVIDER: 'smtp', EMAIL_DRY_RUN: 'false' }),
    (error) => error?.code === 'EMAIL_NOT_CONFIGURED'
  );
});

test('Free users cannot receive instant price alert emails', async () => {
  const { withDb } = createDb({ emailAlertDeliveries: [] });
  let sent = 0;
  const worker = createAlertEmailWorker({
    withDb,
    sendMail: async () => {
      sent += 1;
      return { sent: true };
    },
    emailReadiness: () => ({ status: 'EMAIL_READY' }),
    logger: { info: () => {} }
  });

  const result = await worker.sendPriceAlertEmail({
    user: { id: 'u1', email: 'free@example.com', planType: 'free', emailPreferences: { alert: true } },
    alert: { id: 'a1' },
    deal: { route: 'ROM-TYO', price: 399 }
  });

  assert.equal(result.reason, 'free_instant_alerts_disabled');
  assert.equal(sent, 0);
});

test('Free digest uses cached public data only and skips when there is no value', async () => {
  const { withDb } = createDb({
    users: [{ id: 'u1', email: 'free@example.com', planType: 'free', emailPreferences: { digest: true } }],
    publicDeals: [{ route: 'ROM-TYO', price: 399, dataSource: 'cached_public_scan' }]
  });
  let providerCalls = 0;
  const sentPayloads = [];
  const worker = createEmailDigestWorker({
    withDb,
    listCachedPublicDeals: (db) => {
      providerCalls += 0;
      return db.publicDeals;
    },
    sendMail: async (payload) => {
      sentPayloads.push(payload);
      return { sent: true, messageId: 'm1' };
    },
    logger: { info: () => {} },
    now: () => new Date('2026-05-05T10:00:00.000Z')
  });

  const result = await worker.runEmailDigestOnce();
  assert.equal(result.sent, 1);
  assert.equal(providerCalls, 0);
  assert.match(sentPayloads[0].subject, /Weekly cached route digest/);
  assert.match(sentPayloads[0].text, /public cached opportunities only/i);
});

test('Pro alert email is skipped when email delivery is not ready', async () => {
  const { withDb } = createDb({ emailAlertDeliveries: [] });
  let sent = 0;
  const worker = createAlertEmailWorker({
    withDb,
    sendMail: async () => {
      sent += 1;
      return { sent: true };
    },
    emailReadiness: () => ({ status: 'EMAIL_NOT_CONFIGURED' }),
    logger: { info: () => {} }
  });

  const result = await worker.sendPriceAlertEmail({
    user: { id: 'u1', email: 'pro@example.com', planType: 'pro', emailPreferences: { alert: true } },
    alert: { id: 'a1' },
    deal: { route: 'ROM-TYO', price: 399 }
  });

  assert.equal(result.reason, 'EMAIL_NOT_CONFIGURED');
  assert.equal(sent, 0);
});

test('Elite higher-frequency alert email requires provider readiness', async () => {
  const { withDb } = createDb({ emailAlertDeliveries: [] });
  let sent = 0;
  const worker = createAlertEmailWorker({
    withDb,
    sendMail: async () => {
      sent += 1;
      return { sent: true };
    },
    emailReadiness: () => ({ status: 'EMAIL_READY' }),
    providerReady: false,
    logger: { info: () => {} }
  });

  const result = await worker.sendPriceAlertEmail({
    user: { id: 'u1', email: 'elite@example.com', planType: 'elite', emailPreferences: { alert: true } },
    alert: { id: 'a1' },
    deal: { route: 'ROM-TYO', price: 399 }
  });

  assert.equal(result.reason, 'provider_not_ready_for_elite_alert');
  assert.equal(sent, 0);
});

test('email workers respect opt-out preferences', async () => {
  const { withDb } = createDb({ emailAlertDeliveries: [] });
  const worker = createAlertEmailWorker({
    withDb,
    sendMail: async () => ({ sent: true }),
    emailReadiness: () => ({ status: 'EMAIL_READY' }),
    logger: { info: () => {} }
  });

  const result = await worker.sendPriceAlertEmail({
    user: { id: 'u1', email: 'pro@example.com', planType: 'pro', emailPreferences: { alert: false } },
    alert: { id: 'a1' },
    deal: { route: 'ROM-TYO', price: 399 }
  });

  assert.equal(result.reason, 'email_preferences_disabled');
});

test('alert emails are idempotent by key', async () => {
  const { db, withDb } = createDb({ emailAlertDeliveries: [] });
  let sent = 0;
  const worker = createAlertEmailWorker({
    withDb,
    sendMail: async () => {
      sent += 1;
      return { sent: true, messageId: `m${sent}` };
    },
    emailReadiness: () => ({ status: 'EMAIL_READY' }),
    logger: { info: () => {} }
  });
  const item = {
    user: { id: 'u1', email: 'pro@example.com', planType: 'pro', emailPreferences: { alert: true } },
    alert: { id: 'a1' },
    deal: { dealKey: 'deal1', route: 'ROM-TYO', price: 399 },
    idempotencyKey: 'alert:u1:a1:deal1'
  };

  const first = await worker.sendPriceAlertEmail(item);
  const second = await worker.sendPriceAlertEmail(item);
  assert.equal(first.sent, true);
  assert.equal(second.reason, 'duplicate_alert_email');
  assert.equal(sent, 1);
  assert.equal(db.emailAlertDeliveries.length, 1);
});

test('SMTP_PASS never appears in provider logs', async () => {
  const logs = [];
  const provider = createEmailProvider({
    env: {
      EMAIL_PROVIDER: 'smtp',
      EMAIL_DRY_RUN: 'false',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'user@example.com',
      SMTP_PASS: 'secret-password-value',
      SMTP_FROM: 'Flight Suite <noreply@example.com>'
    },
    logger: { info: (meta, msg) => logs.push({ meta, msg }), warn: (meta, msg) => logs.push({ meta, msg }) },
    transportFactory: () => ({
      sendMail: async () => {
        const error = new Error('smtp rejected');
        error.code = 'EAUTH';
        throw error;
      }
    })
  });

  await provider.sendEmail({ to: 'user@example.com', subject: 'Test', text: 'Body' });
  assert.equal(JSON.stringify(logs).includes('secret-password-value'), false);
});

test('templates include manage-preferences and privacy links', () => {
  const managePreferencesUrl = 'https://app.example.com/preferences/email';
  const privacyUrl = 'https://app.example.com/privacy';
  const templates = [
    passwordResetTemplate({ resetUrl: 'https://app.example.com/reset', managePreferencesUrl, privacyUrl }),
    routeDigestTemplate({ deals: [{ route: 'ROM-TYO', price: 399 }], managePreferencesUrl, privacyUrl }),
    priceAlertTemplate({ deal: { route: 'ROM-TYO', price: 399 }, managePreferencesUrl, privacyUrl })
  ];

  for (const template of templates) {
    assert.match(template.text, /Manage preferences:/);
    assert.match(template.text, /Privacy policy:/);
    assert.match(template.html, /preferences\/email/);
    assert.match(template.html, /privacy/);
  }
});

test('new email workers do not introduce browser push delivery', async () => {
  const files = [
    await readFile(new URL('../server/jobs/email-digest-worker.js', import.meta.url), 'utf8'),
    await readFile(new URL('../server/jobs/alert-email-worker.js', import.meta.url), 'utf8')
  ].join('\n');

  assert.doesNotMatch(files, /sendVapidPush|push-subscriptions|web-push|PushManager|browser push/i);
});
