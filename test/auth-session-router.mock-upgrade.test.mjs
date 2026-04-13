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

function createApp({ db, authEvents }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 'u1', email: 'user@example.com' };
    next();
  });

  app.use(
    '/api',
    buildAuthSessionRouter({
      authGuard: (_req, _res, next) => next(),
      csrfGuard: (_req, _res, next) => next(),
      withDb: async (fn) => fn(db),
      readDb: async () => db,
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
      authCookieOptions: () => ({ secure: false }),
      ACCESS_COOKIE_TTL_MS: 60_000,
      REFRESH_COOKIE_TTL_MS: 60_000,
      AUTH_COOKIE_DOMAIN: '',
      sendMachineError: (_req, res, status, error) => res.status(status).json({ error }),
      refreshCsrfGuard: (_req, _res, next) => next(),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      rotateRefreshSession: async () => null,
      signRefreshToken: () => 'refresh',
      signAccessToken: () => 'access',
      speakeasy: {
        generateSecret: () => ({ base32: 'BASE32', otpauth_url: 'otpauth://mock' }),
        totp: { verify: () => true }
      },
      QRCode: { toDataURL: async () => 'data:image/png;base64,mock' },
      mfaCodeSchema: { safeParse: () => ({ success: true, data: { token: '123456' } }) }
    })
  );

  return app;
}

test('upgrade mock endpoints are blocked by default in production', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousMockFlag = process.env.ALLOW_MOCK_BILLING_UPGRADES;
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_MOCK_BILLING_UPGRADES;

  try {
    const db = {
      users: [{ id: 'u1', email: 'user@example.com', isPremium: false, planType: 'free', planStatus: 'active' }]
    };
    const authEvents = [];
    const app = createApp({ db, authEvents });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/upgrade/pro`, { method: 'POST' });
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.error, 'billing_upgrade_mock_disabled');
    });

    assert.equal(db.users[0].planType, 'free');
    assert.equal(db.users[0].isPremium, false);
    assert.equal(authEvents.length, 1);
    assert.equal(authEvents[0].type, 'billing_upgrade_mock_blocked');
    assert.equal(authEvents[0].success, false);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousMockFlag == null) delete process.env.ALLOW_MOCK_BILLING_UPGRADES;
    else process.env.ALLOW_MOCK_BILLING_UPGRADES = previousMockFlag;
  }
});

test('upgrade mock endpoints can be enabled explicitly for non-production environments', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousMockFlag = process.env.ALLOW_MOCK_BILLING_UPGRADES;
  process.env.NODE_ENV = 'development';
  process.env.ALLOW_MOCK_BILLING_UPGRADES = 'true';

  try {
    const db = {
      users: [{ id: 'u1', email: 'user@example.com', isPremium: false, planType: 'free', planStatus: 'active' }]
    };
    const authEvents = [];
    const app = createApp({ db, authEvents });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/upgrade/elite`, { method: 'POST' });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.planType, 'elite');
      assert.equal(body.isPremium, true);
    });

    assert.equal(db.users[0].planType, 'elite');
    assert.equal(db.users[0].isPremium, true);
    assert.equal(authEvents.length, 1);
    assert.equal(authEvents[0].type, 'billing_upgrade_elite_mock');
    assert.equal(authEvents[0].success, true);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousMockFlag == null) delete process.env.ALLOW_MOCK_BILLING_UPGRADES;
    else process.env.ALLOW_MOCK_BILLING_UPGRADES = previousMockFlag;
  }
});
