import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi, openEmailAuth } from './helpers/app-test-kit';

test.beforeEach(async ({ page }) => {
  await bootLanding(page, createDefaultState());
});

test('landing theme toggle is coherent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await expect(page.locator('.landing-cta-primary')).toBeVisible();
  await expect(page.locator('.landing-cta-ghost')).toBeVisible();
  await expect(page.locator('main.landing-shell')).toHaveClass(/landing-dark/);

  await page.locator('.landing-theme-btn').click();

  await expect(page.locator('main.landing-shell')).not.toHaveClass(/landing-dark/);
  await expect(page.locator('.landing-accedi-btn')).toBeVisible();
});

test('auth modal keeps dark visuals with no white surfaces', async ({ page }) => {
  await openEmailAuth(page);

  await expect(page.locator('.account-drawer-backdrop')).toHaveClass(/app-dark/);

  const panelBg = await page.locator('.auth-panel-surface').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(panelBg.toLowerCase()).not.toContain('255, 255, 255');
});

test('app shell theme toggle remains coherent after login', async ({ page }) => {
  await loginFromUi(page);
  await expect(page.locator('main.page.app-shell')).toHaveClass(/app-dark/);

  await page.locator('.hero-controls .landing-theme-btn').click();

  await expect(page.locator('main.page.app-shell')).not.toHaveClass(/app-dark/);
  await expect(page.locator('.app-main-nav')).toBeVisible();
});

test('mobile: landing and auth modal remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.landing-cta-primary')).toBeVisible();
  await expect(page.locator('.landing-cta-ghost')).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);

  await openEmailAuth(page);
  await expect(page.locator('.auth-modal-drawer')).toBeVisible();
  await expect(page.locator('.auth-shell h3')).toBeVisible();
});
