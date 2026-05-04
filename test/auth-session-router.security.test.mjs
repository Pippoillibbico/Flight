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
