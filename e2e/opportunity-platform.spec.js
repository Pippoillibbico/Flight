import { expect, test } from '@playwright/test';

function createState() {
  return {
    isLoggedIn: false,
    radar: {
      id: 'r1',
      originAirports: ['FCO'],
      favoriteDestinations: ['Tokyo'],
      favoriteCountries: ['Japan'],
      budgetCeiling: 500,
      preferredTravelMonths: [11]
    },
    opportunities: [
      {
        id: 'opp-1',
        origin_city: 'Rome',
        origin_airport: 'FCO',
        destination_city: 'Tokyo',
        destination_airport: 'TYO',
        price: 489,
        currency: 'EUR',
        depart_date: '2026-11-10',
        return_date: '2026-11-18',
        trip_length_days: 8,
        stops: 1,
        airline: 'partner_feed',
        opportunity_level: 'Exceptional price',
        ai_description: 'Opportunita reale selezionata dal radar.'
      }
    ]
  };
}

async function setupMocks(page, state) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const json = (payload, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(payload)
      });

    if (path === '/api/config') {
      return json({
        origins: [{ code: 'FCO', label: 'Roma Fiumicino (FCO)' }],
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
          pro: { monthlyEur: 7 },
          creator: { monthlyEur: 19 },
          updatedAt: new Date().toISOString()
        }
      });
    }
    if (path === '/api/auth/login' && method === 'POST') {
      state.isLoggedIn = true;
      return json({
        token: 'test-token',
        session: { csrfToken: 'csrf-test' },
        user: { id: 'u1', name: 'Test User', email: 'test@example.com', isPremium: true, onboardingDone: true }
      });
    }
    if (path === '/api/auth/me') {
      if (!state.isLoggedIn) return json({ error: 'unauthorized' }, 401);
      return json({
        user: { id: 'u1', name: 'Test User', email: 'test@example.com', isPremium: true, onboardingDone: true },
        session: { csrfToken: 'csrf-test' },
        security: { isLocked: false, lockUntil: null, failedLoginCount: 0 }
      });
    }
    if (path === '/api/auth/refresh') return json({ token: 'test-token' });
    if (path === '/api/search/history') return json({ items: [] });
    if (path === '/api/watchlist') return json({ items: [] });
    if (path === '/api/alerts/subscriptions' && method === 'GET') return json({ items: [] });
    if (path === '/api/notifications' && method === 'GET') return json({ items: [], unread: 0 });
    if (path === '/api/security/activity') return json({ items: [] });

    if (path === '/api/opportunities/feed' && method === 'GET') return json({ items: state.opportunities });
    if (path === '/api/opportunities/opp-1' && method === 'GET') {
      return json({
        item: { ...state.opportunities[0], why_it_matters: 'Score 84/100 su rotta monitorata.' },
        related: [state.opportunities[0]]
      });
    }
    if (path === '/api/opportunities/opp-1/follow' && method === 'POST') return json({ ok: true }, 201);
    if (path === '/api/opportunities/radar/preferences' && method === 'GET') return json({ item: state.radar });
    if (path === '/api/opportunities/radar/preferences' && method === 'PUT') return json({ item: state.radar });
    if (path === '/api/opportunities/ai/query' && method === 'POST') {
      return json({
        summary: 'Trovata 1 opportunita reale.',
        items: state.opportunities
      });
    }

    return json({ ok: true });
  });
}

async function login(page) {
  await page.getByRole('button', { name: 'Accedi' }).first().click();
  await page.locator('.auth-provider-btn').first().click();
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('StrongPass!123');
  await page.locator('.auth-email-form button[type="submit"]').click();
  await expect(page.getByRole('button', { name: 'Test User' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const state = createState();
  await setupMocks(page, state);
  await page.goto('/');
  await page.locator('.landing-lang-inner').selectOption('it');
});

test('home feed and detail flow', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Le opportunita di oggi')).toBeVisible();
  await page.getByRole('button', { name: 'Vedi itinerario' }).first().click();
  await expect(page.getByText('Dettaglio opportunita')).toBeVisible();
  await expect(page.getByText('Score 84/100 su rotta monitorata.')).toBeVisible();
});

test('radar preferences save flow', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Radar' }).click();
  await expect(page.getByText('Attiva il radar delle opportunita')).toBeVisible();
  await page.getByRole('button', { name: 'Salva radar' }).click();
  await expect(page.getByText('Radar aggiornato con successo.')).toBeVisible();
});

test('ai travel query flow', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'AI Travel' }).click();
  await page.getByPlaceholder('I want to leave from Rome with 400 euros in November').fill('Tokyo da Roma con 500 euro a novembre');
  await page.getByRole('button', { name: 'Scopri opportunita' }).click();
  await expect(page.getByText('Trovata 1 opportunita reale.')).toBeVisible();
  await page.getByRole('button', { name: 'Vedi itinerario' }).first().click();
  await expect(page.getByText('Dettaglio opportunita')).toBeVisible();
});

test('premium tab renders plan cards', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Premium' }).click();
  await expect(page.getByText('Sblocca tutte le opportunita')).toBeVisible();
  await expect(page.getByText('PRO')).toBeVisible();
  await expect(page.getByText('ELITE')).toBeVisible();
});
