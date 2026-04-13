import { expect, test } from './helpers/guarded-test';
import { bootMultiCity, fillSegment } from './helpers/multi-city-test-kit';

test('prevent same origin and destination within one segment', async ({ page }) => {
  await bootMultiCity(page);

  await fillSegment(page, 0, { origin: 'MXP', destination: 'MXP', date: '2026-05-10' });
  await fillSegment(page, 1, { origin: 'LIS', destination: 'MAD', date: '2026-05-14' });

  await expect(page.getByTestId('segment-destination-error-0')).toBeVisible();
  await expect(page.getByTestId('submit-search')).toBeDisabled();
});

test('prevent reverse chronology across segments', async ({ page }) => {
  await bootMultiCity(page);

  await fillSegment(page, 0, { origin: 'MXP', destination: 'LIS', date: '2026-05-10' });
  await fillSegment(page, 1, { origin: 'LIS', destination: 'MAD', date: '2026-05-09' });

  await expect(page.getByTestId('segment-date-error-1')).toBeVisible();
  await expect(page.getByTestId('submit-search')).toBeDisabled();
});

test('revalidate dependent segment after previous segment date changes', async ({ page }) => {
  await bootMultiCity(page);

  await fillSegment(page, 0, { origin: 'MXP', destination: 'LIS', date: '2026-05-10' });
  await fillSegment(page, 1, { origin: 'LIS', destination: 'MAD', date: '2026-05-14' });

  await expect(page.getByTestId('submit-search')).toBeEnabled();

  await page.getByLabel('Segment 1 Departure', { exact: true }).fill('2026-05-20');
  await expect(page.getByTestId('segment-date-error-1')).toBeVisible();
  await expect(page.getByTestId('submit-search')).toBeDisabled();

  await page.getByLabel('Segment 2 Departure', { exact: true }).fill('2026-05-21');
  await expect(page.getByTestId('segment-date-error-1')).toHaveCount(0);
  await expect(page.getByTestId('submit-search')).toBeEnabled();
});
