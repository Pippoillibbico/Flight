import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi, openEmailAuth } from './helpers/app-test-kit';

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
  await expect(page.locator('.landing-lang-trigger .landing-ctrl-label')).toHaveText('IT');
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

  await expect(page.getByText('Le opportunita di oggi')).toBeVisible();
  await page.getByRole('button', { name: /Vedi itinerario/i }).first().click();
  await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
  await expect(page.getByText('Dettaglio opportunita')).toBeVisible();

  await page.locator('.app-main-nav').getByRole('button', { name: 'Radar', exact: true }).click();
  await expect(page.getByText('Attiva il radar delle opportunita')).toBeVisible();
  await page.getByRole('button', { name: 'Attiva radar' }).click();
  await expect(page.getByText('Radar aggiornato con successo.')).toBeVisible();

  await page.locator('.app-main-nav').getByRole('button', { name: 'AI Travel', exact: true }).click();
  await expect(page.getByText("Trova il prossimo viaggio con l'AI")).toBeVisible();
  await page.locator('.ai-intake-box').fill('Tokyo da Roma con 500 euro a novembre');
  await page.getByRole('button', { name: "Chiedi all'AI" }).click();
  await expect(page.getByText(/Trovate \d+ opportunita reali\./)).toBeVisible();

  await page.locator('.app-main-nav').getByRole('button', { name: 'Premium', exact: true }).click();
  await expect(page.getByText('Sblocca tutte le opportunita')).toBeVisible();
  await expect(page.locator('.premium-card')).toHaveCount(3);
  await expect(page.locator('.premium-card-featured')).toHaveCount(1);
});

test('mobile viewport has no horizontal overflow on landing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(80);
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
});
