import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { buildUserExportRouter } from '../server/routes/user-export.js';

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function buildApp({ user, state, auditEvents }) {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    buildUserExportRouter({
      authGuard: (req, _res, next) => {
        req.user = { ...user, sub: user.id };
        next();
      },
      requireSessionAuth: (_req, _res, next) => next(),
      quotaGuard: () => (_req, _res, next) => next(),
      withDb: async (fn) => fn(state),
      readDb: async () => state,
      fetchCurrentUser: async () => user,
      appendImmutableAudit: async (event) => auditEvents.push(event)
    })
  );
  return app;
}

test('GDPR export is available to a free authenticated user and does not leak secrets', async () => {
  const user = { id: 'free_user', planType: 'free', planStatus: 'active' };
  const auditEvents = [];
  const state = {
    users: [
      {
        id: user.id,
        email: 'free@example.com',
        name: 'Free User',
        planType: 'free',
        planStatus: 'active',
        emailPreferences: { digest: true, alert: false, marketing: false },
        passwordHash: 'must-not-leak',
        refreshToken: 'must-not-leak',
        accessToken: 'must-not-leak',
        csrfToken: 'must-not-leak',
        mfaSecret: 'must-not-leak',
        mfaTempSecret: 'must-not-leak',
        internalIngestToken: 'must-not-leak',
        outboundClickSecret: 'must-not-leak',
        stripeSecret: 'must-not-leak',
        vapidPrivateKey: 'must-not-leak',
        unsubscribeToken: 'must-not-leak'
      }
    ],
    searches: [{ id: 's1', userId: user.id, payload: { origin: 'MXP', destination: 'LIS' } }],
    priceAlerts: [{ id: 'p1', userId: user.id, origin: 'MXP', destinationIata: 'LIS', targetPrice: 99, enabled: true }],
    watchlists: [{ id: 'w1', userId: user.id, origin: 'MXP', destination: 'LIS' }],
    notifications: [{ id: 'n1', userId: user.id, type: 'alert', message: 'Cached deal ready.' }],
    userSubscriptions: [
      {
        userId: user.id,
        planId: 'free',
        status: 'active',
        stripeCustomerId: 'cus_raw_should_not_leak',
        stripeSubscriptionId: 'sub_raw_should_not_leak'
      }
    ],
    userConsents: [{ userId: user.id, categories: { necessary: true }, version: '2026-01' }],
    authEvents: [{ id: 'a1', userId: user.id, type: 'login_success', success: true, userAgent: 'Test UA' }],
    emailDeliveryLog: [{ id: 'e1', userId: user.id, subject: 'Weekly cached route digest', status: 'sent' }]
  };

  const app = buildApp({ user, state, auditEvents });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/user/gdpr-export`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.export_type, 'gdpr_access');
    assert.equal(body.account.email, 'free@example.com');
    assert.deepEqual(body.email.preferences, { digest: true, alert: false, marketing: false });
    assert.equal(body.search_history.length, 1);
    assert.equal(body.price_alerts.length, 1);
    assert.equal(body.watchlist.length, 1);
    assert.equal(body.notifications.length, 1);
    assert.equal(body.consents.length, 1);
    assert.equal(body.auth_events.length, 1);
    assert.equal(body.billing_refs.length, 1);
    assert.equal(body.billing_refs[0].stripe_customer_id, undefined);
    assert.equal(body.billing_refs[0].stripe_subscription_id, undefined);
    assert.match(body.billing_refs[0].stripe_customer_ref, /^cus_[a-f0-9]{24}$/);
    assert.match(body.billing_refs[0].stripe_subscription_ref, /^sub_[a-f0-9]{24}$/);
    assert.equal(body.billing_refs[0].reference_policy, 'stripe identifiers minimized with stable salted references');
    assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
    assert.equal(JSON.stringify(body).includes('cus_raw_should_not_leak'), false);
    assert.equal(JSON.stringify(body).includes('sub_raw_should_not_leak'), false);
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].targetType, 'user_data_export_gdpr_json');
    assert.equal(auditEvents[0].outcome, 'success');

    const secondResponse = await fetch(`${base}/user/gdpr-export`);
    assert.equal(secondResponse.status, 429);
    const secondBody = await secondResponse.json();
    assert.equal(secondBody.error, 'gdpr_export_rate_limited');
  });
});
