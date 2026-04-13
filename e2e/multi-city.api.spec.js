import { expect, test } from './helpers/guarded-test';
import { addSegmentButton, bootMultiCity, fillSegment, successSearchResponse } from './helpers/multi-city-test-kit';

test('send correct payload preserving segment order', async ({ page }) => {
  await bootMultiCity(page);

  let capturedPayload = null;
  await page.route('**/api/search', async (route, request) => {
    capturedPayload = request.postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(successSearchResponse())
    });
  });

  for (let index = 0; index < 4; index += 1) {
    await addSegmentButton(page).click();
  }

  const routePlan = [
    { origin: 'MXP', destination: 'LIS', date: '2026-05-10' },
    { origin: 'LIS', destination: 'MAD', date: '2026-05-12' },
    { origin: 'MAD', destination: 'ATH', date: '2026-05-14' },
    { origin: 'ATH', destination: 'DXB', date: '2026-05-16' },
    { origin: 'DXB', destination: 'BKK', date: '2026-05-18' },
    { origin: 'BKK', destination: 'TYO', date: '2026-05-20' }
  ];

  for (let index = 0; index < routePlan.length; index += 1) {
    await fillSegment(page, index, routePlan[index]);
  }

  await page.getByTestId('submit-search').click();
  await expect(page.getByTestId('result-card-multi-1')).toBeVisible();

  expect(capturedPayload?.mode).toBe('multi_city');
  expect(capturedPayload?.segments).toEqual(routePlan);
});

test('handle API failure and retry with preserved state', async ({ page }) => {
  await bootMultiCity(page);

  const payloads = [];
  let attempts = 0;
  await page.route('**/api/search', async (route, request) => {
    attempts += 1;
    payloads.push(request.postDataJSON());
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
  await expect(page.getByLabel('Segment 1 Origin', { exact: true })).toHaveValue('MXP');
  await expect(page.getByLabel('Segment 1 Destination', { exact: true })).toHaveValue('LIS');
  await expect(page.getByLabel('Segment 2 Destination', { exact: true })).toHaveValue('MAD');

  await page.getByTestId('retry-multi-city').click();
  await expect(page.getByTestId('result-card-multi-1')).toBeVisible();

  expect(attempts).toBeGreaterThan(3);
  expect(payloads[0]?.segments?.[1]?.destination).toBe('MAD');
  expect(payloads[3]?.segments?.[1]?.destination).toBe('MAD');
});
