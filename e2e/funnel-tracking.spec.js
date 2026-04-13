import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, ensureHomeSection, loginFromUi } from './helpers/app-test-kit';
import { bootMultiCity, fillSegment, successSearchResponse } from './helpers/multi-city-test-kit';

function trackingFlightsResponse() {
  return {
    meta: { count: 2, stayDays: 4 },
    alerts: [],
    flights: [
      {
        id: 'trk-1',
        origin: 'FCO',
        destination: 'Lisbon',
        destinationIata: 'LIS',
        price: 219,
        avg2024: 330,
        savingVs2024: 111,
        stopLabel: 'Direct',
        stopCount: 0,
        departureTimeLabel: '08:15',
        arrivalTimeLabel: '10:40',
        durationHours: 8,
        comfortScore: 82,
        bookingLink: 'https://booking.travel-decision-engine.com/search?destination=LIS'
      },
      {
        id: 'trk-2',
        origin: 'FCO',
        destination: 'Athens',
        destinationIata: 'ATH',
        price: 279,
        avg2024: 350,
        savingVs2024: 71,
        stopLabel: '1 stop',
        stopCount: 1,
        departureTimeLabel: '11:10',
        arrivalTimeLabel: '15:20',
        durationHours: 10,
        comfortScore: 71,
        bookingLink: 'https://booking.travel-decision-engine.com/search?destination=ATH'
      }
    ]
  };
}

async function attachFunnelCollector(page) {
  await page.evaluate(() => {
    window.__funnelEvents = [];
    window.addEventListener('flight_funnel_event', (event) => {
      window.__funnelEvents.push(event.detail || null);
    });
  });
}

test('tracks search/results lifecycle and booking redirect observability on results flow', async ({ page }) => {
  await bootLanding(page, createDefaultState(), { language: 'en' });
  await loginFromUi(page);
  await ensureHomeSection(page);
  await attachFunnelCollector(page);

  await page.route('**/api/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(trackingFlightsResponse())
    });
  });

  await page.route('**/api/outbound/click', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });

  await page.evaluate(() => {
    window.__openedUrls = [];
    window.open = (url) => {
      window.__openedUrls.push(String(url || ''));
      return { closed: false };
    };
  });

  await page.getByRole('button', { name: /^Explore$/, exact: true }).click();
  await page.getByTestId('submit-search').click();
  await expect(page.getByTestId('book-result-trk-1')).toBeVisible();
  await page.getByTestId('book-result-trk-1').click();

  const openedUrls = await page.evaluate(() => window.__openedUrls || []);
  expect(openedUrls.some((url) => String(url).includes('/api/outbound/resolve?'))).toBeTruthy();

  await expect
    .poll(async () => {
      const events = await page.evaluate(() => window.__funnelEvents || []);
      return events.length;
    })
    .toBeGreaterThanOrEqual(6);

  const funnelEvents = await page.evaluate(() => window.__funnelEvents || []);
  const eventTypes = funnelEvents.map((entry) => entry?.eventType);
  expect(eventTypes).toContain('search_submitted');
  expect(eventTypes).toContain('results_rendered');
  expect(eventTypes).toContain('search_succeeded');
  expect(eventTypes).toContain('result_interaction_clicked');
  expect(eventTypes).toContain('booking_clicked');
  expect(eventTypes).toContain('outbound_redirect_succeeded');

  const bookingInteraction = funnelEvents.find(
    (entry) =>
      entry?.eventType === 'result_interaction_clicked' &&
      entry?.action === 'book_cta' &&
      entry?.surface === 'search_results' &&
      entry?.itineraryId === 'trk-1'
  );
  expect(bookingInteraction).toBeTruthy();

  const bookingClicked = funnelEvents.find(
    (entry) => entry?.eventType === 'booking_clicked' && entry?.itineraryId === 'trk-1'
  );
  const redirectSucceeded = funnelEvents.find(
    (entry) => entry?.eventType === 'outbound_redirect_succeeded' && entry?.itineraryId === 'trk-1'
  );
  expect(String(bookingClicked?.correlationId || '')).toMatch(/^corr_/);
  expect(redirectSucceeded?.correlationId).toBe(bookingClicked?.correlationId);
});

test('tracks itinerary_opened when opening opportunity detail from feed', async ({ page }) => {
  await bootLanding(page, createDefaultState(), { language: 'en' });
  await loginFromUi(page);
  await ensureHomeSection(page);
  await attachFunnelCollector(page);

  await page.getByTestId('opportunity-view-opp-1').click();
  await expect(page.getByRole('heading', { name: 'Opportunity detail' })).toBeVisible();

  await expect
    .poll(async () => {
      const events = await page.evaluate(() => window.__funnelEvents || []);
      return events.filter((entry) => entry?.eventType === 'itinerary_opened').length;
    })
    .toBe(1);

  const funnelEvents = await page.evaluate(() => window.__funnelEvents || []);
  const itineraryEvent = funnelEvents.find((entry) => entry?.eventType === 'itinerary_opened');
  expect(itineraryEvent?.surface).toBe('opportunity_feed');
  expect(itineraryEvent?.itineraryId).toBe('opp-1');
});

test('tracks multi-city failure and retry flow consistently', async ({ page }) => {
  await bootMultiCity(page);
  await attachFunnelCollector(page);

  let attempts = 0;
  await page.route('**/api/search', async (route) => {
    attempts += 1;
    if (attempts <= 3) {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'limit_exceeded', message: 'Temporary provider limit.' })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(successSearchResponse())
    });
  });

  await fillSegment(page, 0, { origin: 'MXP', destination: 'LIS', date: '2026-05-10' });
  await fillSegment(page, 1, { origin: 'LIS', destination: 'MAD', date: '2026-05-14' });

  await page.getByTestId('submit-search').click();
  await expect(page.getByTestId('retry-multi-city')).toBeVisible();

  await page.getByTestId('retry-multi-city').click();
  await expect(page.getByTestId('result-card-multi-1')).toBeVisible();

  const funnelEvents = await page.evaluate(() => window.__funnelEvents || []);
  const eventTypes = funnelEvents.map((entry) => entry?.eventType);
  expect(eventTypes).toContain('search_submitted');
  expect(eventTypes).toContain('search_failed');
  expect(eventTypes).toContain('search_retry_clicked');
  expect(eventTypes).toContain('results_rendered');
  expect(eventTypes).toContain('search_succeeded');

  const retryEvent = funnelEvents.find((entry) => entry?.eventType === 'search_retry_clicked');
  expect(retryEvent?.searchMode).toBe('multi_city');
});
