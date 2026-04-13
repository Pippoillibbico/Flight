import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi } from './helpers/app-test-kit';

function buildDealSearchResponse() {
  return {
    meta: { count: 4, stayDays: 6 },
    alerts: [],
    flights: [
      {
        id: 'deal-great',
        origin: 'FCO',
        destination: 'Lisbon',
        destinationIata: 'LIS',
        price: 180,
        avg2024: 360,
        stopLabel: 'Direct',
        stopCount: 0,
        departureTimeLabel: '07:10',
        arrivalTimeLabel: '09:15',
        durationHours: 6,
        comfortScore: 88
      },
      {
        id: 'deal-good',
        origin: 'FCO',
        destination: 'Athens',
        destinationIata: 'ATH',
        price: 260,
        avg2024: 340,
        stopLabel: 'Direct',
        stopCount: 0,
        departureTimeLabel: '08:10',
        arrivalTimeLabel: '12:10',
        durationHours: 9,
        comfortScore: 80
      },
      {
        id: 'deal-fair',
        origin: 'FCO',
        destination: 'Madrid',
        destinationIata: 'MAD',
        price: 300,
        avg2024: 320,
        stopLabel: '1 stop',
        stopCount: 1,
        departureTimeLabel: '06:40',
        arrivalTimeLabel: '12:40',
        durationHours: 12,
        comfortScore: 66
      },
      {
        id: 'deal-over',
        origin: 'FCO',
        destination: 'Tokyo',
        destinationIata: 'TYO',
        price: 390,
        avg2024: 350,
        stopLabel: '2 stops',
        stopCount: 2,
        departureTimeLabel: '06:00',
        arrivalTimeLabel: '22:45',
        durationHours: 14,
        comfortScore: 44
      }
    ]
  };
}

async function runSearch(page) {
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced mode' }).click();
  await page.getByTestId('submit-search').click();
}

test('results expose deterministic deal labels and allow deal-priority sorting', async ({ page }) => {
  await bootLanding(page, createDefaultState(), { language: 'en' });
  await loginFromUi(page);

  await page.route('**/api/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildDealSearchResponse())
    });
  });

  await runSearch(page);

  await expect(page.getByTestId('deal-label-deal-great')).toContainText('Great deal');
  await expect(page.getByTestId('deal-label-deal-good')).toContainText('Good value');
  await expect(page.getByTestId('deal-label-deal-fair')).toContainText('Fair price');
  await expect(page.getByTestId('deal-label-deal-over')).toContainText('Overpriced');

  await page.getByLabel('Sort by').selectOption('deal');
  const orderedCardIds = await page.locator('[data-testid^="result-card-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  expect(orderedCardIds.slice(0, 4)).toEqual(['result-card-deal-great', 'result-card-deal-good', 'result-card-deal-fair', 'result-card-deal-over']);
});

test('mobile results keep deal labels visible without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootLanding(page, createDefaultState(), { language: 'en' });
  await loginFromUi(page);

  await page.route('**/api/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildDealSearchResponse())
    });
  });

  await runSearch(page);

  await expect(page.getByTestId('deal-label-deal-great')).toBeVisible();
  await expect(page.getByTestId('deal-label-deal-over')).toBeVisible();

  const firstCardOverflow = await page.getByTestId('result-card-deal-great').evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(firstCardOverflow).toBe(false);
});

