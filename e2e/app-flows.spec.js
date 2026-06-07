import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, ensureHomeSection, loginFromUi } from './helpers/app-test-kit';

async function mockStripeCheckoutNavigation(page) {
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>Stripe Checkout test page</title></head><body>Stripe Checkout</body></html>'
    })
  );
}

test('free plan shows localized upgrade prompts and cached triangulation preview', async ({ page }) => {
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
  await expect(page.locator('.radar-panel .upgrade-prompt')).toContainText('Nessun addebito in questo passaggio');

  await page.getByTestId('app-nav-ai-travel').click();
  await expect(page.getByTestId('ai-travel-run')).toBeEnabled();
  await page.getByTestId('ai-travel-run').click();
  await expect(page.getByTestId('upgrade-flow-modal-pro')).toBeVisible();
  await page.getByTestId('upgrade-flow-close').click();

  await page.getByTestId('triangulation-run').click();
  await expect(page.getByTestId('triangulation-preview-list')).toBeVisible();
  await expect(page.getByTestId('triangulation-preview-list')).toContainText('Roma -> Budapest -> Bangkok');
  await expect(page.getByTestId('triangulation-preview-list')).toContainText('Strategia indicativa basata su rotte frequenti e storico prezzi');
  await expect(page.locator('.triangulation-panel .upgrade-prompt')).toContainText('Passa a PRO per confrontare prezzi aggiornati');
});

test('free user can start PRO checkout through a locally intercepted Stripe page', async ({ page }) => {
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
  await mockStripeCheckoutNavigation(page);

  await page.getByTestId('app-nav-premium').click();
  await page.getByTestId('premium-upgrade-pro').click();
  await expect(page.getByTestId('upgrade-flow-modal-pro')).toBeVisible();
  await Promise.all([
    page.waitForURL('https://checkout.stripe.com/**'),
    page.getByTestId('upgrade-flow-primary').click()
  ]);
  await expect(page).toHaveURL('https://checkout.stripe.com/c/pay/test_session');
});

test('English Free triangulation preview stays cached and does not leak Italian copy', async ({ page }) => {
  await bootLanding(page, createDefaultState({
    user: {
      isPremium: false,
      planType: 'free'
    }
  }), { language: 'en' });
  await loginFromUi(page);
  await page.getByTestId('app-nav-ai-travel').click();

  await page.getByTestId('triangulation-run').click();
  const preview = page.getByTestId('triangulation-preview-list');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Rome -> Budapest -> Bangkok');
  await expect(preview).toContainText('Indicative strategy based on frequent routes and price history');
  await expect(preview).not.toContainText('Strategia indicativa');
  await expect(page.locator('.triangulation-panel .upgrade-prompt')).toContainText('Upgrade to compare updated prices');
});

test('tracked-route Free soft limit triggers contextual upgrade without bypassing checkout', async ({ page }) => {
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

  await expect(page.getByTestId('opportunity-track-limit-prompt')).toBeVisible();
  await expect(page.getByTestId('opportunity-track-cluster-southeast-asia')).toBeDisabled();
  await expect(page.getByTestId('opportunity-track-cluster-nordics')).toBeDisabled();

  await page.getByTestId('opportunity-track-limit-upgrade-pro').click();
  await expect(page.getByTestId('upgrade-flow-modal-pro')).toBeVisible();
  await expect(page.getByTestId('upgrade-flow-description')).toContainText('AI Flight Hacker');
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
