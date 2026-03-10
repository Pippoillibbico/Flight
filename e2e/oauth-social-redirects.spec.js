import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';

const OAUTH_TEST_PORT = 8090;
const OAUTH_BASE_URL = `http://127.0.0.1:${OAUTH_TEST_PORT}`;

let oauthServerProcess;

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
    oauthServerProcess = spawn('node', ['server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(OAUTH_TEST_PORT),
        FRONTEND_URL: 'http://localhost:5173',
        GOOGLE_CLIENT_ID: '599506202244-ge9mgt54bvadap7ntp1sentfk4nirp1e.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'test_google_secret',
        GOOGLE_REDIRECT_URI: `${OAUTH_BASE_URL}/auth/google/callback`,
        FACEBOOK_APP_ID: '1441318720679123',
        FACEBOOK_APP_SECRET: 'test_facebook_secret',
        FACEBOOK_REDIRECT_URI: `${OAUTH_BASE_URL}/auth/facebook/callback`
      },
      stdio: 'pipe'
    });

    oauthServerProcess.stdout?.on('data', (data) => {
      process.stdout.write(`[oauth-server] ${String(data)}`);
    });
    oauthServerProcess.stderr?.on('data', (data) => {
      process.stderr.write(`[oauth-server][err] ${String(data)}`);
    });

    await waitForHealth(request);
  });

  test.afterAll(async () => {
    if (oauthServerProcess && !oauthServerProcess.killed) {
      oauthServerProcess.kill('SIGTERM');
    }
  });

  test('GET /auth/facebook redirects with valid OAuth params', async ({ request }) => {
    const response = await request.get(`${OAUTH_BASE_URL}/auth/facebook`, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);

    const location = response.headers()['location'];
    expect(location).toBeTruthy();

    const url = new URL(location);
    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.pathname).toBe('/v19.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('1441318720679123');
    expect(url.searchParams.get('redirect_uri')).toBe(`${OAUTH_BASE_URL}/auth/facebook/callback`);
    expect(url.searchParams.get('scope')).toBe('email,public_profile');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  test('GET /auth/google redirects with valid OAuth params', async ({ request }) => {
    const response = await request.get(`${OAUTH_BASE_URL}/auth/google`, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);

    const location = response.headers()['location'];
    expect(location).toBeTruthy();

    const url = new URL(location);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.pathname).toBe('/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('599506202244-ge9mgt54bvadap7ntp1sentfk4nirp1e.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe(`${OAUTH_BASE_URL}/auth/google/callback`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });
});
