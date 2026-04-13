import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, ensureHomeSection, loginFromUi } from './helpers/app-test-kit';

test('free plan shows soft upgrade prompts across feed, radar and AI limits', async ({ page }) => {
  test.slow();
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
  state.opportunities = state.opportunities.map((item, index) => ({
    ...item,
    id: `opp-free-${index + 1}`,
    origin_city: 'Milan',
    origin_airport: 'MXP'
  }));
  await bootLanding(page, state);
  await loginFromUi(page);
  await ensureHomeSection(page);
  await expect(page.locator('.hero-controls .landing-accedi-btn')).toContainText('Test User');

  await expect(page.locator('.opportunity-feed-panel .upgrade-prompt')).toBeVisible();

  await page.getByTestId('app-nav-radar').click();
  await expect(page.locator('.radar-panel .upgrade-prompt')).toBeVisible();

  await page.getByTestId('app-nav-ai-travel').click();
  await expect(page.getByTestId('ai-travel-run')).toBeEnabled();
  await page.getByTestId('ai-travel-prompt-input').fill('Trip from Rome with best value');
  await page.getByTestId('ai-travel-run').click();
  await expect(page.locator('.ai-travel-candidate-card')).toHaveCount(3);
  await expect(page.locator('.ai-travel-results-section .upgrade-prompt')).toBeVisible();
  await expect(page.locator('.ai-travel-results-section .upgrade-prompt')).toContainText('See more AI-generated itineraries');
});

test('free user can upgrade to PRO locally and new plan is persisted', async ({ page }) => {
  test.slow();
  const state = createDefaultState({
    user: {
      isPremium: false,
      planType: 'free'
    }
  });
  await bootLanding(page, state);
  await loginFromUi(page);
  await ensureHomeSection(page);

  await page.getByTestId('app-nav-premium').click();
  await page.getByTestId('premium-upgrade-pro').click();
  await expect(page.getByTestId('upgrade-flow-modal-pro')).toBeVisible();
  await page.getByTestId('upgrade-flow-primary').click();
  await expect(page.getByTestId('upgrade-flow-success')).toBeVisible();
  const storedPlan = await page.evaluate(() => window.localStorage.getItem('flight_user_plan_v1'));
  expect(storedPlan).toBe('pro');
});

test('tracked-route soft limit triggers contextual upgrade and unlocks after PRO upgrade', async ({ page }) => {
  test.slow();
  const state = createDefaultState({
    user: {
      isPremium: false,
      planType: 'free'
    },
    clusters: [
      { id: 1, cluster_name: 'Japan', slug: 'japan', region: 'asia', min_price: 489, opportunities_count: 2 },
      { id: 2, cluster_name: 'Southeast Asia', slug: 'southeast-asia', region: 'asia', min_price: 418, opportunities_count: 2 },
      { id: 3, cluster_name: 'USA East Coast', slug: 'usa-east-coast', region: 'america', min_price: 312, opportunities_count: 2 },
      { id: 4, cluster_name: 'Nordics', slug: 'nordics', region: 'eu', min_price: 199, opportunities_count: 3 }
    ]
  });
  await bootLanding(page, state);
  await loginFromUi(page);
  await ensureHomeSection(page);

  await page.getByTestId('opportunity-track-cluster-japan').click();
  await page.getByTestId('opportunity-track-cluster-southeast-asia').click();
  await page.getByTestId('opportunity-track-cluster-usa-east-coast').click();

  await expect(page.getByTestId('opportunity-track-limit-prompt')).toBeVisible();
  await expect(page.getByTestId('opportunity-track-cluster-nordics')).toBeDisabled();

  await page.getByTestId('opportunity-track-limit-upgrade-pro').click();
  await expect(page.getByTestId('upgrade-flow-modal-pro')).toBeVisible();
  await page.getByTestId('upgrade-flow-primary').click();
  await expect(page.getByTestId('upgrade-flow-success')).toBeVisible();
  await page.getByTestId('upgrade-flow-success-close').click();

  await expect(page.getByTestId('opportunity-track-cluster-nordics')).toBeEnabled();
  await page.getByTestId('opportunity-track-cluster-nordics').click();
  await expect(page.getByTestId('opportunity-track-cluster-nordics')).toContainText('Tracking');
});

test('cluster selection filters feed opportunities', async ({ page }) => {
  test.slow();
  await bootLanding(page, createDefaultState());
  await loginFromUi(page);
  await ensureHomeSection(page);

  await expect(page.locator('.opportunity-feed-list .opportunity-card')).toHaveCount(6);

  await page.getByTestId('opportunity-select-cluster-japan').click();
  await expect(page.locator('.opportunity-feed-list .opportunity-card')).toHaveCount(2);

  await page.getByRole('button', { name: /Mostra tutto|Show all/i }).click();
  await expect(page.locator('.opportunity-feed-list .opportunity-card')).toHaveCount(6);
});
