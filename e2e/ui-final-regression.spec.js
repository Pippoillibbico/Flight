import { expect, test } from '@playwright/test';

function createApiMockState() {
  return {
    isLoggedIn: false,
    notifications: [],
    subscriptions: []
  };
}

async function setupApiMocks(page, state) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    const json = (payload, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(payload)
      });

    if (path === '/api/config') {
      return json({
        origins: [
          { code: 'MXP', label: 'Milano (MXP)' },
          { code: 'FCO', label: 'Roma (FCO)' }
        ],
        regions: ['all', 'eu', 'asia', 'america', 'oceania'],
        cabins: ['economy', 'premium', 'business'],
        connectionTypes: ['all', 'direct', 'with_stops'],
        travelTimes: ['all', 'day', 'night'],
        countriesByRegion: {}
      });
    }

    if (path === '/api/billing/pricing') {
      return json({
        pricing: {
          free: { monthlyEur: 0 },
          pro: { monthlyEur: 12.99 },
          creator: { monthlyEur: 29.99 },
          updatedAt: new Date().toISOString(),
          lastCostCheckAt: new Date().toISOString()
        }
      });
    }

    if (path === '/api/auth/login' && method === 'POST') {
      state.isLoggedIn = true;
      return json({
        token: 'test-token',
        session: { csrfToken: 'csrf-test' },
        user: {
          id: 'u1',
          name: 'Test User',
          email: 'test@example.com',
          isPremium: true,
          mfaEnabled: false,
          onboardingDone: true
        }
      });
    }

    if (path === '/api/auth/me') {
      if (!state.isLoggedIn) return json({ error: 'unauthorized' }, 401);
      return json({
        user: {
          id: 'u1',
          name: 'Test User',
          email: 'test@example.com',
          isPremium: true,
          mfaEnabled: false,
          onboardingDone: true
        },
        session: { csrfToken: 'csrf-test' },
        security: { isLocked: false, lockUntil: null, failedLoginCount: 0 }
      });
    }

    if (path === '/api/auth/refresh') return json({ token: 'test-token' });
    if (path === '/api/search/history') return json({ items: [] });
    if (path === '/api/watchlist') return json({ items: [] });
    if (path === '/api/security/activity') return json({ items: [] });
    if (path === '/api/alerts/subscriptions' && method === 'GET') return json({ items: state.subscriptions });
    if (path === '/api/notifications' && method === 'GET') return json({ items: state.notifications, unread: 0 });

    return json({ ok: true });
  });
}

test.beforeEach(async ({ page }) => {
  const state = createApiMockState();
  await setupApiMocks(page, state);
  await page.goto('/');
});

test('desktop: landing renders correctly in dark and light mode', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await expect(page.getByRole('button', { name: 'Find deals now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set an alert' })).toBeVisible();
  await expect(page.locator('main.landing-shell')).toHaveClass(/landing-dark/);

  await page.getByRole('button', { name: /Switch to light mode/i }).click();
  await expect(page.locator('main.landing-shell')).not.toHaveClass(/landing-dark/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('desktop: i18n switches hero copy and CTA in italian', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await expect(page.getByText('Stop chasing flights. Let prices chase you.')).toBeVisible();
  await page.locator('.landing-lang-inner').selectOption('it');
  await expect(page.getByText('Smetti di inseguire voli. Fatti inseguire dai prezzi.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trova affari adesso' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Imposta un alert' })).toBeVisible();
});

test('desktop: login modal has no duplicated fields in options view', async ({ page }) => {
  await page.getByRole('button', { name: 'Find deals now' }).click();
  await expect(page.locator('.auth-shell')).toBeVisible();

  const optionsButtons = page.locator('.social-auth-stack .auth-provider-btn');
  const optionsCount = await optionsButtons.count();

  if (optionsCount > 0) {
    await expect(optionsButtons).toHaveCount(4);
    await expect(page.locator('.auth-email-form')).toHaveCount(0);
    await page.locator('.social-auth-stack .auth-provider-btn').first().click();
    await expect(page.locator('.auth-email-form')).toBeVisible();
    await expect(page.locator('.social-auth-stack')).toHaveCount(0);
  } else {
    await expect(page.locator('.auth-email-form')).toBeVisible();
    await expect(page.locator('.social-auth-stack')).toHaveCount(0);
  }
});

test('desktop: app header controls stay coherent in locked app shell', async ({ page }) => {
  await page.getByRole('button', { name: 'Find deals now' }).click();
  await expect(page.locator('.app-lock-panel')).toBeVisible();
  await expect(page.locator('.hero-controls .app-ctrl-btn')).toHaveCount(2);
  await expect(page.locator('.hero-controls .app-account-btn')).toBeVisible();
});

test('mobile: landing and auth modal remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Find deals now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set an alert' })).toBeVisible();

  await page.getByRole('button', { name: 'Find deals now' }).click();
  await expect(page.locator('.auth-modal-drawer')).toBeVisible();
  await expect(page.locator('.auth-shell h3')).toBeVisible();
});
