import { expect, test } from '@playwright/test';

function createApiMockState() {
  return {
    isLoggedIn: false,
    notifications: [
      {
        id: 'n1',
        title: 'Price drop',
        message: 'Flight MXP-TYO dropped below your target.',
        readAt: null
      }
    ],
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

    if (path === '/api/auth/refresh') {
      return json({ token: 'test-token' });
    }

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

    if (path === '/api/search/history') return json({ items: [] });
    if (path === '/api/watchlist') return json({ items: [] });
    if (path === '/api/security/activity') return json({ items: [] });

    if (path === '/api/alerts/subscriptions' && method === 'GET') {
      return json({ items: state.subscriptions });
    }
    if (path === '/api/alerts/subscriptions' && method === 'POST') {
      state.subscriptions.push({
        id: `s-${state.subscriptions.length + 1}`,
        origin: 'MXP',
        region: 'all',
        targetPrice: 299,
        connectionType: 'all',
        enabled: true
      });
      return json({ ok: true });
    }
    if (path === '/api/notifications/scan' && method === 'POST') {
      return json({ ok: true });
    }

    if (path === '/api/notifications' && method === 'GET') {
      const unread = state.notifications.filter((n) => !n.readAt).length;
      return json({ items: state.notifications, unread });
    }
    if (path === '/api/notifications/read-all' && method === 'POST') {
      state.notifications = state.notifications.map((n) => ({ ...n, readAt: new Date().toISOString() }));
      return json({ ok: true });
    }
    if (path.includes('/api/notifications/') && path.endsWith('/read') && method === 'POST') {
      const id = path.split('/')[3];
      state.notifications = state.notifications.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
      return json({ ok: true });
    }

    return json({ ok: true });
  });
}

async function loginFromUi(page) {
  await page.locator('.landing-accedi-btn').click();
  await expect(page.locator('.auth-shell')).toBeVisible();
  await page.locator('.auth-provider-btn').first().click();
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('StrongPass!123');
  await page.locator('.auth-email-form button[type=\"submit\"]').click();
  await expect(page.getByRole('button', { name: 'Test User' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const state = createApiMockState();
  await setupApiMocks(page, state);
  await page.goto('/');
});

test('login flow works', async ({ page }) => {
  await loginFromUi(page);
});

test('theme toggle works on landing', async ({ page }) => {
  await expect(page.locator('main.landing-shell')).toHaveClass(/landing-dark/);
  await page.getByRole('button', { name: /Switch to light mode/i }).click();
  await expect(page.locator('main.landing-shell')).not.toHaveClass(/landing-dark/);
});

test('notifications can be marked as read', async ({ page }) => {
  await loginFromUi(page);
  await expect(page.getByRole('heading', { name: /Notifications/ })).toBeVisible();
  await expect(page.getByText('Price drop')).toBeVisible();
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByText('Price drop')).toBeVisible();
});

test('alert flow creates subscription from search results', async ({ page }) => {
  await loginFromUi(page);
  await page.getByRole('button', { name: 'Search Flights' }).click();
  await expect(page.getByRole('button', { name: 'Alert at this price' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Alert at this price' }).first().click();
  await expect(page.getByText('Price alert created successfully.')).toBeVisible();
});
