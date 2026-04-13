import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, ensureHomeSection, loginFromUi } from './helpers/app-test-kit';

function buildSearchResponse() {
  return {
    meta: { count: 3, stayDays: 4 },
    alerts: [],
    flights: [
      {
        id: 'fco-tyo',
        origin: 'FCO',
        destination: 'Tokyo',
        destinationIata: 'TYO',
        price: 185,
        avg2024: 420,
        savingVs2024: 235,
        stopLabel: '2 stops',
        stopCount: 2,
        departureTimeLabel: '06:20',
        arrivalTimeLabel: '23:10',
        durationHours: 17,
        comfortScore: 54,
        bookingLink: 'https://booking.travel-decision-engine.com/search?destination=TYO',
        link: 'https://booking.travel-decision-engine.com/search?destination=TYO'
      },
      {
        id: 'fco-lis',
        origin: 'FCO',
        destination: 'Lisbon',
        destinationIata: 'LIS',
        price: 210,
        avg2024: 320,
        savingVs2024: 110,
        stopLabel: 'Direct',
        stopCount: 0,
        departureTimeLabel: '09:40',
        arrivalTimeLabel: '11:55',
        durationHours: 8,
        comfortScore: 82,
        bookingLink: 'https://booking.travel-decision-engine.com/search?destination=LIS',
        link: 'https://booking.travel-decision-engine.com/search?destination=LIS'
      },
      {
        id: 'fco-ath',
        origin: 'FCO',
        destination: 'Athens',
        destinationIata: 'ATH',
        price: 340,
        avg2024: 390,
        savingVs2024: 50,
        stopLabel: 'Direct',
        stopCount: 0,
        departureTimeLabel: '07:10',
        arrivalTimeLabel: '10:20',
        durationHours: 7,
        comfortScore: 76,
        bookingLink: 'https://booking.travel-decision-engine.com/search?destination=ATH',
        link: 'https://booking.travel-decision-engine.com/search?destination=ATH'
      }
    ]
  };
}

async function searchWithMockedFlights(page, response = buildSearchResponse()) {
  const exploreTab = page.getByRole('button', { name: 'Explore', exact: true });
  await exploreTab.click();
  await expect(page.getByTestId('submit-search')).toBeVisible();

  await page.route('**/api/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });
  await page.getByTestId('submit-search').click();
  for (const flight of response.flights) {
    await expect(page.getByTestId(`book-result-${flight.id}`)).toBeVisible();
  }
}

test('book click generates redirect URL and fires booking_clicked tracking', async ({ page, context }) => {
  const state = createDefaultState();
  await bootLanding(page, state, { language: 'en' });
  await loginFromUi(page);
  await ensureHomeSection(page);

  await page.evaluate(() => {
    window.__bookingEvents = [];
    window.addEventListener('booking_clicked', (event) => {
      window.__bookingEvents.push(event.detail || null);
    });
  });

  const trackedClicks = [];
  await page.route('**/api/outbound/click', async (route, request) => {
    trackedClicks.push(request.postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });

  await context.route('**/api/outbound/resolve**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>redirect intercepted</body></html>'
    });
  });

  await searchWithMockedFlights(page);

  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('book-result-fco-tyo').click()]);
  await popup.waitForLoadState('domcontentloaded');

  expect(popup.url()).toContain('/api/outbound/resolve?');
  expect(popup.url()).toContain('partner=tde_booking');
  expect(popup.url()).toContain('surface=results');
  const popupCorrelationId = new URL(popup.url()).searchParams.get('correlationId');
  expect(String(popupCorrelationId || '')).toMatch(/^corr_/);

  await expect.poll(() => trackedClicks.length).toBe(1);
  expect(trackedClicks[0]?.eventName).toBe('booking_clicked');
  expect(trackedClicks[0]?.itineraryId).toBe('fco-tyo');
  const providerKey = trackedClicks[0]?.partner || trackedClicks[0]?.provider || trackedClicks[0]?.providerKey;
  if (providerKey) expect(providerKey).toBe('tde_booking');
  expect(String(trackedClicks[0]?.correlationId || '')).toMatch(/^corr_/);
  expect(trackedClicks[0]?.correlationId).toBe(popupCorrelationId);

  const bookingEvents = await page.evaluate(() => window.__bookingEvents || []);
  expect(bookingEvents.length).toBeGreaterThan(0);
  expect(bookingEvents[0]?.eventName).toBe('booking_clicked');
  expect(bookingEvents[0]?.itineraryId).toBe('fco-tyo');
  expect(bookingEvents[0]?.providerType).toBe('affiliate');
  expect(bookingEvents[0]?.correlationId).toBe(popupCorrelationId);
});

test('opportunity detail booking uses handoff layer and tracking', async ({ page, context }) => {
  const state = createDefaultState();
  await bootLanding(page, state, { language: 'en' });
  await loginFromUi(page);
  await ensureHomeSection(page);

  await page.evaluate(() => {
    window.__bookingEvents = [];
    window.addEventListener('booking_clicked', (event) => {
      window.__bookingEvents.push(event.detail || null);
    });
  });

  const trackedClicks = [];
  await page.route('**/api/outbound/click', async (route, request) => {
    trackedClicks.push(request.postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });

  await context.route('**/api/outbound/resolve**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>detail redirect intercepted</body></html>'
    });
  });

  await page.getByTestId('opportunity-view-opp-1').click();
  await expect(page.getByRole('heading', { name: 'Opportunity detail' })).toBeVisible();

  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('book-opportunity-detail').click()]);
  await popup.waitForLoadState('domcontentloaded');

  expect(popup.url()).toContain('/api/outbound/resolve?');
  expect(popup.url()).toContain('surface=opportunity_detail');
  const popupCorrelationId = new URL(popup.url()).searchParams.get('correlationId');
  expect(String(popupCorrelationId || '')).toMatch(/^corr_/);

  await expect.poll(() => trackedClicks.length).toBe(1);
  expect(String(trackedClicks[0]?.itineraryId || '')).toMatch(/^opp-/);
  expect(trackedClicks[0]?.eventName).toBe('booking_clicked');
  expect(trackedClicks[0]?.correlationId).toBe(popupCorrelationId);
});

test('booking handoff failure shows recoverable error and allows retry on valid itinerary', async ({ page, context }) => {
  const state = createDefaultState();
  await bootLanding(page, state, { language: 'en' });
  await loginFromUi(page);
  await ensureHomeSection(page);

  const trackedClicks = [];
  await page.route('**/api/outbound/click', async (route, request) => {
    trackedClicks.push(request.postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });

  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page.getByTestId('submit-search')).toBeVisible();

  await page.route('**/api/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        meta: { count: 2, stayDays: 4 },
        alerts: [],
        flights: [
          {
            id: 'broken-1',
            origin: 'FCO',
            destination: 'Unknown city',
            destinationIata: '',
            price: 120,
            avg2024: 300,
            savingVs2024: 180,
            stopLabel: 'Direct',
            stopCount: 0,
            departureTimeLabel: '07:00',
            arrivalTimeLabel: '09:00',
            durationHours: 2,
            comfortScore: 80
          },
          {
            id: 'ok-1',
            origin: 'FCO',
            destination: 'Lisbon',
            destinationIata: 'LIS',
            price: 210,
            avg2024: 320,
            savingVs2024: 110,
            stopLabel: 'Direct',
            stopCount: 0,
            departureTimeLabel: '09:40',
            arrivalTimeLabel: '11:55',
            durationHours: 8,
            comfortScore: 82,
            bookingLink: 'https://booking.travel-decision-engine.com/search?destination=LIS'
          }
        ]
      })
    });
  });

  await context.route('**/api/outbound/resolve**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>retry redirect intercepted</body></html>'
    });
  });

  await page.getByTestId('submit-search').click();
  await page.getByTestId('book-result-broken-1').click();
  await expect(page.getByTestId('booking-handoff-error')).toBeVisible();

  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('book-result-ok-1').click()]);
  await popup.waitForLoadState('domcontentloaded');
  expect(popup.url()).toContain('/api/outbound/resolve?');
  await expect.poll(() => trackedClicks.length).toBe(1);
  expect(trackedClicks[0]?.eventName).toBe('booking_clicked');
  expect(trackedClicks[0]?.itineraryId).toBe('ok-1');
});

test('opportunity detail booking failure is recoverable via related opportunity handoff', async ({ page, context }) => {
  const state = createDefaultState({
    opportunities: [
      {
        id: 'opp-broken',
        currency: 'EUR',
        airline: 'partner_feed',
        booking_url: '',
        ai_description: 'Broken booking payload.',
        why_it_matters: 'Missing destination airport for test.',
        raw_score: 71,
        final_score: 78,
        origin_city: 'Rome',
        origin_airport: 'FCO',
        destination_city: 'Unknown',
        destination_airport: '',
        destination_country: 'Spain',
        destination_region: 'eu',
        destination_cluster_slug: 'spain',
        price: 199,
        depart_date: '2026-10-11',
        return_date: '2026-10-18',
        trip_length_days: 7,
        stops: 1
      },
      {
        id: 'opp-valid',
        currency: 'EUR',
        airline: 'partner_feed',
        booking_url: 'https://booking.travel-decision-engine.com/search?destination=LIS',
        ai_description: 'Valid booking payload.',
        why_it_matters: 'Valid destination airport for retry flow.',
        raw_score: 83,
        final_score: 89,
        origin_city: 'Rome',
        origin_airport: 'FCO',
        destination_city: 'Lisbon',
        destination_airport: 'LIS',
        destination_country: 'Portugal',
        destination_region: 'eu',
        destination_cluster_slug: 'portugal',
        price: 239,
        depart_date: '2026-11-02',
        return_date: '2026-11-08',
        trip_length_days: 6,
        stops: 0
      }
    ]
  });
  await bootLanding(page, state, { language: 'en' });
  await loginFromUi(page);
  await ensureHomeSection(page);

  const trackedClicks = [];
  await page.route('**/api/outbound/click', async (route, request) => {
    trackedClicks.push(request.postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });

  await context.route('**/api/outbound/resolve**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>detail retry redirect intercepted</body></html>'
    });
  });

  await page.getByTestId('opportunity-view-opp-broken').click();
  await expect(page.getByRole('heading', { name: 'Opportunity detail' })).toBeVisible();

  await page.getByTestId('book-opportunity-detail').click();
  await expect(page.getByTestId('opportunity-booking-error')).toBeVisible();
  await expect(page.getByTestId('retry-book-opportunity-detail')).toBeVisible();

  await page.getByTestId('related-opportunity-opp-valid').click();
  await expect(page.getByTestId('opportunity-detail-route')).toContainText('FCO -> LIS');
  await expect(page.getByTestId('opportunity-booking-error')).toHaveCount(0);

  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('book-opportunity-detail').click()]);
  await popup.waitForLoadState('domcontentloaded');
  expect(popup.url()).toContain('/api/outbound/resolve?');
  expect(popup.url()).toContain('surface=opportunity_detail');

  await expect.poll(() => trackedClicks.length).toBe(1);
  expect(trackedClicks[0]?.eventName).toBe('booking_clicked');
  expect(trackedClicks[0]?.itineraryId).toBe('opp-valid');
});

test('travel score is visible and sorting by score reorders results', async ({ page }) => {
  const state = createDefaultState();
  await bootLanding(page, state, { language: 'en' });
  await loginFromUi(page);
  await ensureHomeSection(page);

  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced mode' }).click();
  await searchWithMockedFlights(page);

  await expect(page.getByTestId('travel-score-fco-tyo')).toContainText(/Travel Score \d+\/100/);
  await expect(page.getByTestId('travel-score-fco-lis')).toContainText(/Travel Score \d+\/100/);
  await expect(page.getByTestId('travel-score-fco-ath')).toContainText(/Travel Score \d+\/100/);

  await page.getByLabel('Sort by').selectOption('travelScore');
  const firstCardId = await page.locator('[data-testid^="result-card-"]').first().getAttribute('data-testid');
  expect(firstCardId).toBe('result-card-fco-lis');
});

test('different itineraries produce different travel score ordering', async ({ page }) => {
  const state = createDefaultState();
  await bootLanding(page, state, { language: 'en' });
  await loginFromUi(page);
  await ensureHomeSection(page);

  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced mode' }).click();
  await searchWithMockedFlights(page);

  const parseScore = (text) => {
    const match = String(text || '').match(/(\d+)\s*\/\s*100/);
    return match ? Number(match[1]) : null;
  };
  const beforeScores = {};
  for (const id of ['fco-lis', 'fco-tyo', 'fco-ath']) {
    beforeScores[id] = parseScore(await page.getByTestId(`travel-score-${id}`).textContent());
  }
  expect(beforeScores['fco-lis']).not.toBeNull();
  expect(beforeScores['fco-tyo']).not.toBeNull();
  expect(beforeScores['fco-ath']).not.toBeNull();
  expect(new Set(Object.values(beforeScores)).size).toBeGreaterThan(1);

  await page.getByLabel('Sort by').selectOption('travelScore');

  const orderedCardIds = await page
    .locator('[data-testid^="result-card-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') || '').filter(Boolean));
  const orderedTopThree = orderedCardIds.slice(0, 3).map((entry) => entry.replace('result-card-', ''));
  const orderedScores = orderedTopThree.map((id) => Number(beforeScores[id]));
  expect(orderedScores[0]).toBeGreaterThanOrEqual(orderedScores[1]);
  expect(orderedScores[1]).toBeGreaterThanOrEqual(orderedScores[2]);
});
