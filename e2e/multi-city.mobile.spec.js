import { expect, test } from './helpers/guarded-test';
import { addSegmentButton, bootMultiCity } from './helpers/multi-city-test-kit';

test('mobile usability: controls are visible and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootMultiCity(page);

  await addSegmentButton(page).click();
  await expect(addSegmentButton(page)).toBeVisible();
  await expect(page.getByTestId('submit-search')).toBeVisible();

  const panelOverflow = await page.getByTestId('multi-city-panel').evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(panelOverflow).toBe(false);

  const rowOverflow = await page.getByTestId('multi-city-segment-0').evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(rowOverflow).toBe(false);
});

