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

    if (path === '/api/auth/register' && method === 'POST') {
      state.isLoggedIn = true;
      return json({
        token: 'test-token',
        session: { csrfToken: 'csrf-test' },
        user: {
          id: 'u1',
          name: 'Test User',
          email: 'test@example.com',
          isPremium: false,
          mfaEnabled: false,
          onboardingDone: true
        }
      }, 201);
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
    if (path === '/api/notifications') return json({ items: [], unread: 0 });
    if (path === '/api/alerts/subscriptions' && method === 'GET') return json({ items: state.subscriptions });

    if (path === '/api/search' && method === 'POST') {
      return json({
        meta: { count: 1, stayDays: 4 },
        alerts: [],
        flights: [
          {
            id: 'mxp-tyo-1',
            origin: 'MXP',
            destination: 'Tokyo',
            destinationIata: 'TYO',
            price: 299,
            avg2024: 400,
            savingVs2024: 101,
            stopLabel: 'Direct',
            stopCount: 0,
            departureTimeLabel: '09:30',
            arrivalTimeLabel: '17:20',
            durationHours: 12,
            comfortScore: 80,
            bookingLink: 'https://example.com/book',
            link: 'https://example.com/book'
          }
        ]
      });
    }

    return json({ ok: true });
  });
}

async function completeEmailLogin(page) {
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('StrongPass!123');
  await page.locator('.auth-email-form button[type="submit"]').click();
}

test.beforeEach(async ({ page }) => {
  const state = createApiMockState();
  await setupApiMocks(page, state);
  await page.goto('/');
});

test('guest -> login -> redirect to requested action (find deals)', async ({ page }) => {
  await page.getByRole('button', { name: 'Find deals now' }).click();
  await expect(page.locator('.auth-shell')).toBeVisible();
  await expect(page.locator('.app-lock-panel')).toBeVisible();

  await completeEmailLogin(page);

  await expect(page.getByRole('button', { name: 'Test User' })).toBeVisible();
  await expect(page.getByText('You are in. Start with a quick search to unlock the best deals.')).toBeVisible();
  await expect(page.locator('.app-lock-panel')).toHaveCount(0);
});

test('set alert from landing keeps coherent post-auth intent', async ({ page }) => {
  await page.getByRole('button', { name: 'Set an alert' }).click();
  await expect(page.locator('.auth-shell')).toBeVisible();
  await expect(page.locator('.auth-tabs .tab.active')).toContainText('Register');

  await page.getByLabel('Full name').fill('Test User');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('StrongPass!123');
  await page.locator('.auth-email-form button[type="submit"]').click();

  await expect(page.getByText('Great, you are in. Run a search and tap "Alert at this price" on the flight you want.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search Flights' })).toBeVisible();
});

test('back navigation is coherent across lock panel and auth modal', async ({ page }) => {
  await page.getByRole('button', { name: 'Find deals now' }).click();
  await expect(page.locator('.auth-shell')).toBeVisible();
  await page.locator('.auth-close-btn').click();
  await expect(page.locator('.app-lock-panel')).toBeVisible();

  await page.getByRole('button', { name: 'Torna alla home' }).click();
  await expect(page.getByRole('button', { name: 'Find deals now' })).toBeVisible();
  await expect(page.locator('.app-lock-panel')).toHaveCount(0);

  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.auth-shell')).toBeVisible();

  const optionsModeButton = page.getByRole('button', { name: 'Continue with email' });
  if (await optionsModeButton.count()) {
    await optionsModeButton.click();
    await expect(page.locator('.auth-email-form')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
  }
});
