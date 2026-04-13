import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi } from './helpers/app-test-kit';

function buildRadarSearchResponse() {
  return {
    meta: { count: 4, stayDays: 5 },
    alerts: [],
    flights: [
      {
        id: 'radar-hot',
        origin: 'FCO',
        destination: 'Lisbon',
        destinationIata: 'LIS',
        price: 180,
        avg2024: 360,
        stopLabel: 'Direct',
        stopCount: 0,
        departureTimeLabel: '07:20',
        arrivalTimeLabel: '09:30',
        durationHours: 6,
        comfortScore: 88
      },
      {
        id: 'radar-watch',
        origin: 'FCO',
        destination: 'Athens',
        destinationIata: 'ATH',
        price: 260,
        avg2024: 340,
        stopLabel: 'Direct',
        stopCount: 0,
        departureTimeLabel: '08:30',
        arrivalTimeLabel: '12:40',
        durationHours: 8,
        comfortScore: 80
      },
      {
        id: 'radar-none-a',
        origin: 'FCO',
        destination: 'Madrid',
        destinationIata: 'MAD',
        price: 300,
        avg2024: 320,
        stopLabel: '1 stop',
        stopCount: 1,
        departureTimeLabel: '06:40',
        arrivalTimeLabel: '12:50',
        durationHours: 12,
        comfortScore: 64
      },
      {
        id: 'radar-none-b',
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
        comfortScore: 45
      }
    ]
  };
}

async function runSearch(page) {
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced mode' }).click();
  await page.getByTestId('submit-search').click();
}

test('results expose radar states and support radar-priority sorting', async ({ page }) => {
  await bootLanding(page, createDefaultState(), { language: 'en' });
  await loginFromUi(page);

  await page.route('**/api/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildRadarSearchResponse())
    });
  });

  await runSearch(page);

  await expect(page.getByTestId('radar-badge-radar-hot')).toContainText('Radar hot');
  await expect(page.getByTestId('radar-badge-radar-watch')).toContainText('Radar watch');
  await expect(page.getByTestId('radar-badge-radar-none-b')).toContainText('Radar none');

  await page.getByLabel('Sort by').selectOption('radar');
  const orderedCardIds = await page.locator('[data-testid^="result-card-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  expect(orderedCardIds[0]).toBe('result-card-radar-hot');
  expect(orderedCardIds[1]).toBe('result-card-radar-watch');
});

test('mobile radar indicators remain visible without overflowing cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootLanding(page, createDefaultState(), { language: 'en' });
  await loginFromUi(page);

  await page.route('**/api/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildRadarSearchResponse())
    });
  });

  await runSearch(page);

  await expect(page.getByTestId('radar-badge-radar-hot')).toBeVisible();
  await expect(page.getByTestId('radar-badge-radar-watch')).toBeVisible();

  const overflow = await page.getByTestId('result-card-radar-hot').evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(overflow).toBe(false);
});

