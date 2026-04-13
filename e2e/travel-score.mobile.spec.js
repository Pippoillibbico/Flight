import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi } from './helpers/app-test-kit';

function buildMobileSearchResponse() {
  return {
    meta: { count: 3, stayDays: 4 },
    alerts: [],
    flights: [
      {
        id: 'm-fco-tyo',
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
        comfortScore: 54
      },
      {
        id: 'm-fco-lis',
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
        comfortScore: 82
      },
      {
        id: 'm-fco-ath',
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
        comfortScore: 76
      }
    ]
  };
}

test('mobile travel score rendering and sorting stay stable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootLanding(page, createDefaultState(), { language: 'en' });
  await loginFromUi(page);

  await page.route('**/api/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildMobileSearchResponse())
    });
  });

  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced mode' }).click();
  await page.getByTestId('submit-search').click();

  await expect(page.getByTestId('travel-score-m-fco-tyo')).toContainText(/Travel Score \d+\/100/);
  await expect(page.getByTestId('travel-score-m-fco-lis')).toContainText(/Travel Score \d+\/100/);
  await expect(page.getByTestId('travel-score-m-fco-ath')).toContainText(/Travel Score \d+\/100/);

  await page.getByLabel('Sort by').selectOption('travelScore');
  const firstCardId = await page.locator('[data-testid^="result-card-"]').first().getAttribute('data-testid');
  expect(firstCardId).toBe('result-card-m-fco-lis');

  await expect(page.getByTestId('travel-score-m-fco-lis')).toContainText(/Travel Score \d+\/100/);
});
