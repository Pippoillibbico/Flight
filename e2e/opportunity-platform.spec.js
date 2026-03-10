import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi } from './helpers/app-test-kit';

test.beforeEach(async ({ page }) => {
  await bootLanding(page, createDefaultState());
  await loginFromUi(page);
});

test('home feed and detail flow', async ({ page }) => {
  await expect(page.locator('.opportunity-feed-panel')).toBeVisible();
  await expect(page.getByText('Le opportunita di oggi')).toBeVisible();
  await expect(page.locator('.opportunity-card').first()).toBeVisible();

  await page.getByRole('button', { name: 'Vedi itinerario' }).first().click();

  await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
  await expect(page.getByText('Dettaglio opportunita')).toBeVisible();
  await expect(page.getByText('Why this matters')).toBeVisible();
});

test('radar preferences save flow', async ({ page }) => {
  await page.locator('.app-main-nav').getByRole('button', { name: 'Radar', exact: true }).click();

  await expect(page.getByText('Attiva il radar delle opportunita')).toBeVisible();
  await page.locator('.radar-panel input[type="number"]').first().fill('450');
  await page.getByRole('button', { name: 'Attiva radar' }).click();
  await expect(page.getByText('Radar aggiornato con successo.')).toBeVisible();
});

test('ai travel query flow', async ({ page }) => {
  await page.locator('.app-main-nav').getByRole('button', { name: 'AI Travel', exact: true }).click();
  await page.locator('.ai-intake-box').fill('Tokyo da Roma con 500 euro a novembre');
  await page.getByRole('button', { name: "Chiedi all'AI" }).click();
  await expect(page.getByText(/Trovate \d+ opportunita reali\./)).toBeVisible();

  await page.getByRole('button', { name: 'Vedi itinerario' }).first().click();
  await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
});

test('premium tab renders plan cards', async ({ page }) => {
  await page.locator('.app-main-nav').getByRole('button', { name: 'Premium', exact: true }).click();

  await expect(page.getByText('Sblocca tutte le opportunita')).toBeVisible();
  await expect(page.locator('.premium-card')).toHaveCount(3);
  await expect(page.locator('.premium-card-featured')).toHaveCount(1);
  await expect(page.getByText(/7.*mese/)).toBeVisible();
  await expect(page.locator('.premium-plan-tag')).toContainText(['FREE', 'PRO', 'ELITE']);
});

