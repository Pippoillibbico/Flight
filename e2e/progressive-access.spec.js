import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState } from './helpers/app-test-kit';

test.beforeEach(async ({ page }) => {
  await bootLanding(page, createDefaultState());
});

test('guest can browse feed and detail before login, then gets gated on radar', async ({ page }) => {
  await page.locator('.landing-cta-primary').click();

  await expect(page.locator('main.page.app-shell')).toBeVisible();
  await expect(page.locator('.app-main-nav')).toBeVisible();
  await expect(page.locator('.opportunity-feed-list .opportunity-card')).toHaveCount(5);
  await expect(page.locator('.opportunity-soft-gate')).toBeVisible();

  await page.locator('[data-testid^="opportunity-view-"]').first().click();
  await expect(page.locator('.opportunity-detail-panel')).toBeVisible();

  await page.getByTestId('app-nav-radar').click({ force: true });
  await expect(page.locator('.opportunity-soft-gate')).toBeVisible();
  await expect(page.locator('.auth-shell')).toHaveCount(0);

  await page.getByTestId('section-access-gate-cta').click({ force: true });
  await expect(page.locator('.auth-shell')).toBeVisible();
});

test('secondary CTA goes to radar section without forcing login modal', async ({ page }) => {
  await page.locator('.landing-cta-ghost').click();

  await expect(page.locator('main.page.app-shell')).toBeVisible();
  await expect(page.locator('.opportunity-soft-gate')).toBeVisible();
  await expect(page.locator('.auth-shell')).toHaveCount(0);

  await page.locator('.landing-accedi-btn').first().click();
  await expect(page.locator('.auth-shell')).toBeVisible();
});
