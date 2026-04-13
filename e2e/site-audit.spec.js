import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, ensureHomeSection, loginFromUi, openEmailAuth } from './helpers/app-test-kit';

test.beforeEach(async ({ page }) => {
  await bootLanding(page, createDefaultState());
});

test('landing shell renders with stable controls', async ({ page }) => {
  await expect(page.locator('main.landing-shell')).toBeVisible();
  await expect(page.locator('.landing-cta-primary')).toBeVisible();
  await expect(page.locator('.landing-cta-ghost')).toBeVisible();
  await expect(page.locator('.landing-accedi-btn')).toBeVisible();

  await page.locator('.landing-lang-trigger').click();
  await page.getByRole('button', { name: 'Italiano' }).click();
  await expect(page.locator('.landing-lang-trigger .landing-ctrl-label')).toContainText(/IT|Italiano/i);
});

test('auth modal respects dark mode visuals', async ({ page }) => {
  await expect(page.locator('main.landing-shell')).toHaveClass(/landing-dark/);
  await openEmailAuth(page);
  await expect(page.locator('.account-drawer-backdrop')).toHaveClass(/app-dark/);

  const inputBg = await page.locator('.auth-email-form input[type="email"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(inputBg.toLowerCase()).not.toContain('255, 255, 255');
});

test('login enters app shell and main navigation is available', async ({ page }) => {
  await loginFromUi(page);
  await expect(page.locator('main.page.app-shell')).toBeVisible();
  const mainNav = page.locator('.app-main-nav');
  await expect(mainNav.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
  await expect(mainNav.getByRole('button', { name: 'Explore', exact: true })).toBeVisible();
  await expect(mainNav.getByRole('button', { name: 'Radar', exact: true })).toBeVisible();
  await expect(mainNav.getByRole('button', { name: 'AI Travel', exact: true })).toBeVisible();
  await expect(mainNav.getByRole('button', { name: 'Premium', exact: true })).toBeVisible();
});

test('feed, detail, radar, ai travel and premium are navigable', async ({ page }) => {
  await loginFromUi(page);
  await ensureHomeSection(page);

  await expect(page.locator('.opportunity-feed-panel')).toBeVisible();
  await expect(page.locator('.opportunity-card').first()).toBeVisible();
  await page.locator('[data-testid^="opportunity-view-"]').first().click();
  await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
  await expect(page.locator('.opportunity-detail-panel .panel-head h2')).toBeVisible();

  await page.getByTestId('app-nav-radar').click({ force: true });
  await expect(page.locator('.radar-panel')).toBeVisible();
  const saveResponse = page.waitForResponse((response) => {
    return (
      response.url().includes('/api/opportunities/radar/preferences') &&
      response.request().method() === 'PUT' &&
      response.status() === 200
    );
  });
  await page.getByTestId('radar-save-preferences').click({ force: true });
  await saveResponse;

  await page.getByTestId('app-nav-ai-travel').click({ force: true });
  await expect(page.getByTestId('ai-travel-run')).toBeVisible();
  await page.getByTestId('ai-travel-prompt-input').fill('Tokyo da Roma con 500 euro a novembre');
  await page.getByTestId('ai-travel-run').click();
  await expect(page.getByTestId('ai-travel-summary')).toBeVisible();

  await page.getByTestId('app-nav-premium').click({ force: true });
  await expect(page.locator('[data-testid^="premium-plan-"]')).toHaveCount(3);
  await expect(page.locator('.ph-card--featured')).toHaveCount(1);
});

test('mobile viewport has no horizontal overflow on landing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
});
