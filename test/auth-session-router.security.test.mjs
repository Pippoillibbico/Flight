import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildAuthSessionRouter } from '../server/routes/auth-session.js';

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withEnvPatch(patch, fn) {
  const previous = new Map();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    if (patch[key] == null) delete process.env[key];
    else process.env[key] = String(patch[key]);
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

class ExplodingStripeClient {
  constructor() {
    throw new Error('test attempted to construct a real Stripe client');
  }
}

test('auth refresh invalidates cookies when refresh rotation detects token reuse', async () => {
  const db = {
    users: [{ id: 'u1', email: 'user@example.com', name: 'User', isPremium: false, planType: 'free', planStatus: 'active' }]
  };
  let revokedFamily = null;
  const authEvents = [];

  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    buildAuthSessionRouter({
      authGuard: (_req, _res, next) => next(),
      requireSessionAuth: (_req, _res, next) => next(),
      csrfGuard: (_req, _res, next) => next(),
      withDb: async (fn) => fn(db),
      logAuthEvent: async (payload) => {
        authEvents.push(payload);
      },
      userIsLocked: () => false,
      onboardingCompleteSchema: { safeParse: () => ({ success: true, data: {} }) },
      revokeJwt: async () => {},
      getRefreshTokenFromCookie: () => 'refresh-token-cookie',
      verifyRefreshToken: () => ({ sub: 'u1', family: 'fam_1', jti: 'jti_1', csrf: 'csrf_1' }),
      revokeRefreshFamily: async (family) => {
        revokedFamily = family;
      },
      ACCESS_COOKIE_NAME: 'access_token',
      REFRESH_COOKIE_NAME: 'refresh_token',
      authCookieOptions: () => ({ secure: false, sameSite: 'lax' }),
      ACCESS_COOKIE_TTL_MS: 60_000,
      REFRESH_COOKIE_TTL_MS: 60_000,
      AUTH_COOKIE_DOMAIN: '',
      sendMachineError: (_req, res, status, error) => res.status(status).json({ error }),
      refreshCsrfGuard: () => ({ ok: true }),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      rotateRefreshSession: async () => ({ ok: false, reason: 'reused' }),
      signRefreshToken: () => 'next-refresh-token',
      signAccessToken: () => 'next-access-token',
      speakeasy: { generateSecret: () => ({ base32: 'BASE32', otpauth_url: 'otpauth://mock' }), totp: { verify: () => true } },
      QRCode: { toDataURL: async () => 'data:image/png;base64,mock' },
      mfaCodeSchema: { safeParse: () => ({ success: true, data: { code: '123456' } }) }
    })
  );

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'X-CSRF-Token': 'csrf_1'
      }
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, 'Refresh session invalidated.');
    const setCookieHeader = String(response.headers.get('set-cookie') || '');
    assert.match(setCookieHeader, /access_token=/);
    assert.match(setCookieHeader, /refresh_token=/);
  });

  assert.equal(revokedFamily, 'fam_1');
  assert.equal(authEvents.some((event) => event?.type === 'refresh_rejected'), true);
});

test('mfa enable rejects expired temporary setup secret', async () => {
  const staleDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const db = {
    users: [
      {
        id: 'u1',
        email: 'user@example.com',
        name: 'User',
        mfaEnabled: false,
        mfaSecret: null,
        mfaTempSecret: 'TEMP_SECRET',
        mfaTempCreatedAt: staleDate
      }
    ]
  };
  const authEvents = [];

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'u1', email: 'user@example.com' };
    req.authSource = 'cookie';
    next();
  });
  app.use(
    '/api',
    buildAuthSessionRouter({
      authGuard: (_req, _res, next) => next(),
      requireSessionAuth: (_req, _res, next) => next(),
      csrfGuard: (_req, _res, next) => next(),
      withDb: async (fn) => fn(db),
      logAuthEvent: async (payload) => {
        authEvents.push(payload);
      },
      userIsLocked: () => false,
      onboardingCompleteSchema: { safeParse: () => ({ success: true, data: {} }) },
      revokeJwt: async () => {},
      getRefreshTokenFromCookie: () => null,
      verifyRefreshToken: () => ({}),
      revokeRefreshFamily: async () => {},
      ACCESS_COOKIE_NAME: 'access_token',
      REFRESH_COOKIE_NAME: 'refresh_token',
      authCookieOptions: () => ({ secure: false, sameSite: 'lax' }),
      ACCESS_COOKIE_TTL_MS: 60_000,
      REFRESH_COOKIE_TTL_MS: 60_000,
      AUTH_COOKIE_DOMAIN: '',
      sendMachineError: (_req, res, status, error) => res.status(status).json({ error }),
      refreshCsrfGuard: () => ({ ok: true }),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      rotateRefreshSession: async () => ({ ok: true }),
      signRefreshToken: () => 'next-refresh-token',
      signAccessToken: () => 'next-access-token',
      speakeasy: {
        generateSecret: () => ({ base32: 'BASE32', otpauth_url: 'otpauth://mock' }),
        totp: { verify: () => true }
      },
      QRCode: { toDataURL: async () => 'data:image/png;base64,mock' },
      mfaCodeSchema: { safeParse: () => ({ success: true, data: { code: '123456' } }) },
      mfaSetupTtlMs: 15 * 60 * 1000
    })
  );

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456' })
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'MFA setup expired. Start setup again.');
  });

  assert.equal(db.users[0].mfaEnabled, false);
  assert.equal(db.users[0].mfaSecret, null);
  assert.equal(db.users[0].mfaTempSecret, null);
  assert.equal(authEvents.some((event) => event?.type === 'mfa_enable_expired_setup'), true);
});

test('account deletion removes app data, revokes sessions, and keeps minimal billing retention refs', async () => {
  const db = {
    users: [
      {
        id: 'u-delete',
        email: 'delete@example.com',
        name: 'Delete Me',
        passwordHash: 'hash',
        mfaSecret: 'SECRET',
        planType: 'pro',
        planStatus: 'active'
      }
    ],
    watchlists: [{ id: 'w1', userId: 'u-delete' }],
    searches: [{ id: 's1', userId: 'u-delete' }],
    alertSubscriptions: [{ id: 'a1', userId: 'u-delete' }],
    notifications: [{ id: 'n1', userId: 'u-delete' }],
    authEvents: [{ id: 'e1', userId: 'u-delete' }],
    apiKeys: [{ id: 'k1', userId: 'u-delete', keyHash: 'must-delete' }],
    userSubscriptions: [
      {
        userId: 'u-delete',
        planId: 'pro',
        status: 'active',
        stripeSubscriptionId: 'sub_test_123',
        stripeCustomerId: 'cus_test_123'
      }
    ],
    userConsents: [{ userId: 'u-delete', categories: { necessary: true } }],
    consentSessions: [{ anonymousId: 'anon_1', categories: { necessary: true } }]
  };
  const authEvents = [];
  let revokedJwt = false;
  let revokedFamily = null;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'u-delete', email: 'delete@example.com', csrf: 'csrf_1' };
    req.cookies = { anonId: 'anon_1' };
    next();
  });
  app.use(
    '/api',
    buildAuthSessionRouter({
      authGuard: (_req, _res, next) => next(),
      requireSessionAuth: (_req, _res, next) => next(),
      csrfGuard: (_req, _res, next) => next(),
      withDb: async (fn) => fn(db),
      logAuthEvent: async (payload) => {
        authEvents.push(payload);
      },
      userIsLocked: () => false,
      onboardingCompleteSchema: { safeParse: () => ({ success: true, data: {} }) },
      revokeJwt: async () => {
        revokedJwt = true;
      },
      getRefreshTokenFromCookie: () => 'refresh-token-cookie',
      verifyRefreshToken: () => ({ sub: 'u-delete', family: 'fam_delete', jti: 'jti_delete', csrf: 'csrf_1' }),
      revokeRefreshFamily: async (family) => {
        revokedFamily = family;
      },
      ACCESS_COOKIE_NAME: 'access_token',
      REFRESH_COOKIE_NAME: 'refresh_token',
      authCookieOptions: () => ({ secure: false, sameSite: 'lax' }),
      ACCESS_COOKIE_TTL_MS: 60_000,
      REFRESH_COOKIE_TTL_MS: 60_000,
      AUTH_COOKIE_DOMAIN: '',
      sendMachineError: (_req, res, status, error) => res.status(status).json({ error }),
      refreshCsrfGuard: () => ({ ok: true }),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      rotateRefreshSession: async () => ({ ok: true }),
      signRefreshToken: () => 'next-refresh-token',
      signAccessToken: () => 'next-access-token',
      speakeasy: { generateSecret: () => ({ base32: 'BASE32', otpauth_url: 'otpauth://mock' }), totp: { verify: () => true } },
      QRCode: { toDataURL: async () => 'data:image/png;base64,mock' },
      mfaCodeSchema: { safeParse: () => ({ success: true, data: { code: '123456' } }) },
      StripeClient: ExplodingStripeClient
    })
  );

  await withEnvPatch({ STRIPE_SECRET_KEY: null }, async () => {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/account`, { method: 'DELETE' });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);

      const retryResponse = await fetch(`${baseUrl}/api/auth/account`, { method: 'DELETE' });
      assert.equal(retryResponse.status, 200);
      const retryBody = await retryResponse.json();
      assert.equal(retryBody.ok, true);
    });
  });

  assert.equal(db.users.some((user) => user.id === 'u-delete'), false);
  assert.equal(db.watchlists.length, 0);
  assert.equal(db.searches.length, 0);
  assert.equal(db.alertSubscriptions.length, 0);
  assert.equal(db.notifications.length, 0);
  assert.equal(db.authEvents.length, 0);
  assert.equal(db.apiKeys.length, 0);
  assert.equal(db.userSubscriptions.length, 0);
  assert.equal(db.userConsents.length, 0);
  assert.equal(db.consentSessions.length, 0);
  assert.equal(db.billingRetentionRecords.length, 1);
  assert.equal(db.billingRetentionRecords[0].stripeCustomerId, 'cus_test_123');
  assert.equal(db.billingRetentionRecords[0].stripeSubscriptionId, 'sub_test_123');
  assert.equal(db.billingRetentionRecords[0].retainedReason, 'tax_and_payment_dispute_retention');
  assert.equal(revokedJwt, true);
  assert.equal(revokedFamily, 'fam_delete');
  assert.equal(authEvents.some((event) => event?.type === 'account_deleted'), true);
});

test('account deletion cancels active Stripe subscription through injected mock only', async () => {
  const calls = [];
  class MockStripeClient {
    constructor(secret, options) {
      assert.equal(secret, 'sk_test_fake_for_account_delete');
      assert.equal(options.apiVersion, '2026-02-25.clover');
      this.subscriptions = {
        retrieve: async (subscriptionId) => {
          calls.push(['retrieve', subscriptionId]);
          return { id: subscriptionId, status: 'active' };
        },
        cancel: async (subscriptionId, payload) => {
          calls.push(['cancel', subscriptionId, payload?.prorate]);
          return { id: subscriptionId, status: 'canceled' };
        }
      };
    }
  }

  const db = {
    users: [{ id: 'u-stripe', email: 'stripe@example.com', planType: 'pro', planStatus: 'active' }],
    userSubscriptions: [
      {
        userId: 'u-stripe',
        planId: 'pro',
        status: 'active',
        stripeSubscriptionId: 'sub_test_cancel',
        stripeCustomerId: 'cus_test_cancel'
      }
    ],
    refreshSessions: [{ userId: 'u-stripe', family: 'fam_stripe' }]
  };
  const authEvents = [];

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'u-stripe', email: 'stripe@example.com', csrf: 'csrf_1' };
    req.cookies = {};
    next();
  });
  app.use(
    '/api',
    buildAuthSessionRouter({
      authGuard: (_req, _res, next) => next(),
      requireSessionAuth: (_req, _res, next) => next(),
      csrfGuard: (_req, _res, next) => next(),
      withDb: async (fn) => fn(db),
      logAuthEvent: async (payload) => authEvents.push(payload),
      userIsLocked: () => false,
      onboardingCompleteSchema: { safeParse: () => ({ success: true, data: {} }) },
      revokeJwt: async () => {},
      getRefreshTokenFromCookie: () => null,
      verifyRefreshToken: () => ({}),
      revokeRefreshFamily: async () => {},
      ACCESS_COOKIE_NAME: 'access_token',
      REFRESH_COOKIE_NAME: 'refresh_token',
      authCookieOptions: () => ({ secure: false, sameSite: 'lax' }),
      ACCESS_COOKIE_TTL_MS: 60_000,
      REFRESH_COOKIE_TTL_MS: 60_000,
      AUTH_COOKIE_DOMAIN: '',
      sendMachineError: (_req, res, status, error) => res.status(status).json({ error }),
      refreshCsrfGuard: () => ({ ok: true }),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      rotateRefreshSession: async () => ({ ok: true }),
      signRefreshToken: () => 'next-refresh-token',
      signAccessToken: () => 'next-access-token',
      speakeasy: { generateSecret: () => ({ base32: 'BASE32', otpauth_url: 'otpauth://mock' }), totp: { verify: () => true } },
      QRCode: { toDataURL: async () => 'data:image/png;base64,mock' },
      mfaCodeSchema: { safeParse: () => ({ success: true, data: { code: '123456' } }) },
      StripeClient: MockStripeClient
    })
  );

  await withEnvPatch({ STRIPE_SECRET_KEY: 'sk_test_fake_for_account_delete' }, async () => {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/account`, { method: 'DELETE' });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
    });
  });

  assert.deepEqual(calls, [
    ['retrieve', 'sub_test_cancel'],
    ['cancel', 'sub_test_cancel', false]
  ]);
  assert.equal(db.billingRetentionRecords.length, 1);
  assert.equal(db.billingRetentionRecords[0].retainedReason, 'tax_and_payment_dispute_retention');
  assert.equal(authEvents.at(-1).detail, 'stripe_cancel_attempted=true;stripe_canceled=1;stripe_skipped=0');
});
