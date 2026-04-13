import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi } from './helpers/app-test-kit';

test('free plan shows upgrade prompts across feed, radar and AI', async ({ page }) => {
  const state = createDefaultState({
    user: {
      isPremium: false,
      planType: 'free'
    },
    feedAccess: {
      showUpgradePrompt: true,
      upgradeMessage: 'Sblocca tutte le opportunita con PRO'
    }
  });
  await bootLanding(page, state);
  await loginFromUi(page);

  await expect(page.locator('.upgrade-prompt')).toBeVisible();
  await expect(page.getByText('Sblocca tutte le opportunita con PRO')).toBeVisible();

  await page.locator('.app-main-nav').getByRole('button', { name: 'Radar', exact: true }).click();
  await expect(page.getByText('Radar completo disponibile su PRO')).toBeVisible();

  await page.locator('.app-main-nav').getByRole('button', { name: 'AI Travel', exact: true }).click();
  await expect(page.getByText('AI Travel disponibile su ELITE')).toBeVisible();
});

test('free user can upgrade to PRO from premium page', async ({ page }) => {
  const state = createDefaultState({
    user: {
      isPremium: false,
      planType: 'free'
    }
  });
  await bootLanding(page, state);
  await loginFromUi(page);

  await page.locator('.app-main-nav').getByRole('button', { name: 'Premium', exact: true }).click();
  await page.locator('.premium-card-featured').getByRole('button', { name: 'Passa a PRO' }).click();

  await page.getByRole('button', { name: 'Test User' }).click();
  await expect(page.getByText('Piano attivo: PRO')).toBeVisible();
});

test('cluster selection filters feed opportunities', async ({ page }) => {
  await bootLanding(page, createDefaultState());
  await loginFromUi(page);

  await expect(page.locator('.opportunity-feed-list .opportunity-card')).toHaveCount(6);

  await page.locator('.opportunity-cluster-trigger').first().click();
  await expect(page.locator('.opportunity-feed-list .opportunity-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'Mostra tutto' }).click();
  await expect(page.locator('.opportunity-feed-list .opportunity-card')).toHaveCount(6);
});
