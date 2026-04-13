import { expect, test } from './helpers/guarded-test';
import {
  addSegmentButton,
  bootMultiCity,
  fillSegment,
  removeSegmentButton,
  segmentOriginLocator,
  successSearchResponse
} from './helpers/multi-city-test-kit';

test('switch to multi-city shows default 2 segments', async ({ page }) => {
  await bootMultiCity(page);
  await expect(segmentOriginLocator(page, 0)).toBeVisible();
  await expect(segmentOriginLocator(page, 1)).toBeVisible();
});

test('add and remove segments in multi-city mode', async ({ page }) => {
  await bootMultiCity(page);

  await addSegmentButton(page).click();
  await expect(segmentOriginLocator(page, 2)).toBeVisible();

  await removeSegmentButton(page, 2).click();
  await expect(segmentOriginLocator(page, 2)).toHaveCount(0);
});

test('valid submit works in multi-city mode', async ({ page }) => {
  await bootMultiCity(page);

  await page.route('**/api/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(successSearchResponse())
    });
  });

  await fillSegment(page, 0, { origin: 'MXP', destination: 'LIS', date: '2026-05-10' });
  await fillSegment(page, 1, { origin: 'LIS', destination: 'TYO', date: '2026-05-16' });

  await expect(page.getByTestId('submit-search')).toBeEnabled();
  await page.getByTestId('submit-search').click();
  await expect(page.getByTestId('result-card-multi-1')).toBeVisible();
});

test('remove middle segment keeps remaining values stable', async ({ page }) => {
  await bootMultiCity(page);

  await addSegmentButton(page).click();

  await fillSegment(page, 0, { origin: 'MXP', destination: 'LIS', date: '2026-05-10' });
  await fillSegment(page, 1, { origin: 'LIS', destination: 'MAD', date: '2026-05-12' });
  await fillSegment(page, 2, { origin: 'MAD', destination: 'ATH', date: '2026-05-14' });

  await removeSegmentButton(page, 1).click();

  await expect(segmentOriginLocator(page, 1)).toHaveValue('MAD');
  await expect(page.getByLabel('Segment 2 Destination', { exact: true })).toHaveValue('ATH');
  await expect(page.getByLabel('Segment 2 Departure', { exact: true })).toHaveValue('2026-05-14');
});
