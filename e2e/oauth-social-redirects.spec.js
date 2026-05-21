import { test, expect } from '@playwright/test';
import express from 'express';
import { buildAuthOAuthRouter } from '../server/routes/auth-oauth.js';

const OAUTH_TEST_PORT = 8090;
const OAUTH_BASE_URL = `http://127.0.0.1:${OAUTH_TEST_PORT}`;

let oauthServer;
const previousGoogleClientId = process.env.GOOGLE_CLIENT_ID;
const previousFacebookClientId = process.env.FACEBOOK_CLIENT_ID;

async function waitForHealth(request, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await request.get(`${OAUTH_BASE_URL}/health`);
      if (response.ok()) return;
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('OAuth server did not become healthy in time.');
}

test.describe('OAuth Redirect Endpoints', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    process.env.GOOGLE_CLIENT_ID = '599506202244-ge9mgt54bvadap7ntp1sentfk4nirp1e.apps.googleusercontent.com';
    process.env.FACEBOOK_CLIENT_ID = '1441318720679123';

    const app = express();
    app.use(
      buildAuthOAuthRouter({
        authLimiter: (_req, _res, next) => next(),
        frontendUrl: 'http://localhost:5173/login-success',
        googleOAuthRedirectUri: `${OAUTH_BASE_URL}/api/auth/oauth/google/callback`,
        appleOAuthRedirectUri: `${OAUTH_BASE_URL}/api/auth/oauth/apple/callback`,
        facebookOAuthRedirectUri: `${OAUTH_BASE_URL}/api/auth/oauth/facebook/callback`,
        ensureOAuthBrowserBinding: () => 'test-binding',
        createOAuthSession: async (provider, redirectUri) => ({
          id: `${provider}-session`,
          provider,
          redirectUri,
          state: `${provider}-state`,
          nonce: `${provider}-nonce`,
          codeChallenge: `${provider}-challenge`,
          expiresAt: new Date(Date.now() + 600000).toISOString()
        }),
        clearOAuthBrowserBinding: () => {},
        resolveOAuthBindingHash: () => 'test-binding',
        consumeOAuthSessionByState: async () => null,
        consumeOAuthSessionById: async () => null,
        exchangeGoogleCodeForTokens: async () => ({}),
        exchangeAppleCodeForTokens: async () => ({}),
        exchangeFacebookCodeForProfile: async () => ({}),
        verifyGoogleIdToken: async () => ({}),
        verifyAppleIdToken: async () => ({}),
        completeOAuthLogin: async () => ({})
      })
    );
    app.get('/health', (_req, res) => res.json({ ok: true }));

    await new Promise((resolve) => {
      oauthServer = app.listen(OAUTH_TEST_PORT, '127.0.0.1', resolve);
    });

    await waitForHealth(request);
  });

  test.afterAll(async () => {
    if (previousGoogleClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousGoogleClientId;

    if (previousFacebookClientId === undefined) delete process.env.FACEBOOK_CLIENT_ID;
    else process.env.FACEBOOK_CLIENT_ID = previousFacebookClientId;

    if (oauthServer) {
      await new Promise((resolve) => oauthServer.close(resolve));
    }
  });

  test('GET /api/auth/oauth/facebook/start redirects with valid OAuth params', async ({ request }) => {
    const response = await request.get(`${OAUTH_BASE_URL}/api/auth/oauth/facebook/start`, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);

    const location = response.headers()['location'];
    expect(location).toBeTruthy();

    const url = new URL(location);
    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.pathname).toBe('/v20.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('1441318720679123');
    expect(url.searchParams.get('redirect_uri')).toBe(`${OAUTH_BASE_URL}/api/auth/oauth/facebook/callback`);
    expect(url.searchParams.get('scope')).toBe('email,public_profile');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('facebook-state');
  });

  test('GET /api/auth/oauth/google/start redirects with valid OAuth params', async ({ request }) => {
    const response = await request.get(`${OAUTH_BASE_URL}/api/auth/oauth/google/start`, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);

    const location = response.headers()['location'];
    expect(location).toBeTruthy();

    const url = new URL(location);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.pathname).toBe('/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('599506202244-ge9mgt54bvadap7ntp1sentfk4nirp1e.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe(`${OAUTH_BASE_URL}/api/auth/oauth/google/callback`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('google-state');
    expect(url.searchParams.get('nonce')).toBe('google-nonce');
    expect(url.searchParams.get('code_challenge')).toBe('google-challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
