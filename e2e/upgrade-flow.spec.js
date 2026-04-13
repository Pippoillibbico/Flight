import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi } from './helpers/app-test-kit';

function createFreeState() {
  return createDefaultState({
    user: {
      isPremium: false,
      planType: 'free'
    },
    feedAccess: {
      showUpgradePrompt: true,
      upgradeMessage: 'Unlock all opportunities with PRO'
    }
  });
}

async function attachUpgradeCollector(page) {
  await page.evaluate(() => {
    window.__upgradeEvents = [];
    window.addEventListener('flight_upgrade_event', (event) => {
      window.__upgradeEvents.push(event.detail || null);
    });
  });
}

test('Upgrade to PRO opens modal flow and primary action shows confirmation', async ({ page }) => {
  await bootLanding(page, createFreeState(), { language: 'en' });
  await loginFromUi(page);
  await attachUpgradeCollector(page);

  await expect(page.getByTestId('upgrade-cta-pro')).toBeVisible();
  await page.getByTestId('upgrade-cta-pro').click({ force: true });

  await expect(page.getByTestId('upgrade-flow-modal-pro')).toBeVisible();
  await expect(page.getByTestId('upgrade-flow-title')).toContainText('Upgrade to PRO');
  await expect(page.getByTestId('upgrade-flow-plan-tag')).toContainText('PRO');
  await expect(page.getByTestId('upgrade-flow-value-note')).toContainText('Unlock radar alerts, priority deals, and advanced filters');

  await page.getByTestId('upgrade-flow-primary').click({ force: true });
  await expect(page.getByTestId('upgrade-flow-success')).toBeVisible();
  await page.getByTestId('upgrade-flow-success-close').click({ force: true });
  await expect(page.getByTestId('upgrade-flow-modal')).toHaveCount(0);

  const events = await page.evaluate(() => window.__upgradeEvents || []);
  const eventTypes = events.map((entry) => entry?.eventType);
  expect(eventTypes).toContain('upgrade_cta_clicked');
  expect(eventTypes).toContain('upgrade_modal_opened');
  expect(eventTypes).toContain('upgrade_primary_cta_clicked');

  const primaryEvent = events.find(
    (entry) => entry?.eventType === 'upgrade_primary_cta_clicked' && entry?.planType === 'pro'
  );
  expect(primaryEvent?.source).toBe('opportunity_feed_prompt');
});

test('Discover ELITE opens distinct flow, supports close, and confirms primary action', async ({ page }) => {
  await bootLanding(page, createFreeState(), { language: 'en' });
  await loginFromUi(page);
  await attachUpgradeCollector(page);

  await expect(page.getByTestId('upgrade-cta-elite')).toBeVisible();
  await page.getByTestId('upgrade-cta-elite').click({ force: true });

  await expect(page.getByTestId('upgrade-flow-modal-elite')).toBeVisible();
  await expect(page.getByTestId('upgrade-flow-title')).toContainText('Discover ELITE');
  await expect(page.getByTestId('upgrade-flow-plan-tag')).toContainText('ELITE');
  await expect(page.getByTestId('upgrade-flow-value-note')).toContainText('Unlock radar alerts, priority deals, and advanced filters');

  await page.getByTestId('upgrade-flow-close').click({ force: true });
  await expect(page.getByTestId('upgrade-flow-modal')).toHaveCount(0);

  await page.getByTestId('upgrade-cta-elite').click({ force: true });
  await expect(page.getByTestId('upgrade-flow-modal-elite')).toBeVisible();
  await page.getByTestId('upgrade-flow-primary').click({ force: true });
  await expect(page.getByTestId('upgrade-flow-success')).toBeVisible();

  const events = await page.evaluate(() => window.__upgradeEvents || []);
  const eventTypes = events.map((entry) => entry?.eventType);
  expect(eventTypes).toContain('elite_cta_clicked');
  expect(eventTypes).toContain('elite_modal_opened');
  expect(eventTypes).toContain('upgrade_primary_cta_clicked');

  const elitePrimaryEvent = events.find(
    (entry) => entry?.eventType === 'upgrade_primary_cta_clicked' && entry?.planType === 'elite'
  );
  expect(elitePrimaryEvent?.source).toBe('opportunity_feed_prompt');
});

test('upgrade modal remains usable on mobile without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootLanding(page, createFreeState(), { language: 'en' });
  await loginFromUi(page);

  await page.getByTestId('upgrade-cta-pro').click({ force: true });
  await expect(page.getByTestId('upgrade-flow-modal-pro')).toBeVisible();
  await expect(page.getByTestId('upgrade-flow-primary')).toBeVisible();

  const hasOverflow = await page.getByTestId('upgrade-flow-modal').evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(hasOverflow).toBe(false);
});
