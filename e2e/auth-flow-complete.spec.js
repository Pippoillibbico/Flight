import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi, openEmailAuth } from './helpers/app-test-kit';

test.beforeEach(async ({ page }) => {
  await bootLanding(page, createDefaultState());
});

test('landing primary CTA opens app shell for guest without forced login', async ({ page }) => {
  await page.locator('.landing-cta-primary').click();

  await expect(page.locator('main.page.app-shell')).toBeVisible();
  await expect(page.locator('.opportunity-feed-panel')).toBeVisible();
  await expect(page.locator('.auth-shell')).toHaveCount(0);
});

test('email login completes and unlocks main navigation', async ({ page }) => {
  test.slow();
  await loginFromUi(page);

  const nav = page.locator('.app-main-nav');
  await expect(nav.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Explore', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Radar', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'AI Travel', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Premium', exact: true })).toBeVisible();
});

test('email register flow works from auth modal', async ({ page }) => {
  await openEmailAuth(page);

  await page.locator('.auth-inline-link').first().click();

  const genericInputs = page.locator('.auth-email-form input');
  await genericInputs.nth(0).fill('New User');
  await page.locator('.auth-email-form input[type="email"]').fill('new.user@example.com');

  const passwordFields = page.locator('.auth-email-form input[type="password"]');
  await passwordFields.nth(0).fill('StrongPass!123');
  await passwordFields.nth(1).fill('StrongPass!123');

  await page.locator('.auth-email-form button[type="submit"]').click();

  await expect(page.locator('main.page.app-shell')).toBeVisible();
  await expect(page.getByRole('button', { name: /New User|Test User/i })).toBeVisible();
});

test('email form can go back to auth options', async ({ page }) => {
  await openEmailAuth(page);

  await page.getByTestId('auth-back-to-options').click();

  await expect(page.locator('.social-auth-stack')).toBeVisible();
  await expect(page.getByTestId('auth-back-to-options')).toHaveCount(0);
});
