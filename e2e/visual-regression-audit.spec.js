import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, enterAppShellFromLanding, openEmailAuth } from './helpers/app-test-kit';

const SCREENSHOT_DIR = path.resolve('test-results', 'visual-audit');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];
const LANGUAGES = ['it', 'en'];

function createAuthenticatedAuditState(overrides = {}) {
  return createDefaultState({
    isLoggedIn: true,
    user: {
      id: 'u1',
      name: 'Test User',
      email: 'test@example.com',
      isPremium: false,
      planType: 'free',
      onboardingDone: true,
      isInTrial: true,
      trialEndsAt: '2026-06-02T12:00:00.000Z'
    },
    feedAccess: {
      showUpgradePrompt: true,
      upgradeMessage: 'Sblocca tutte le opportunita con PRO'
    },
    ...overrides
  });
}

async function capture(page, fileName) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${fileName}.png`),
    fullPage: true
  });
}

async function captureLocator(locator, fileName) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await locator.screenshot({
    path: path.join(SCREENSHOT_DIR, `${fileName}.png`)
  });
}

async function dismissCookieBannerIfPresent(page) {
  const acceptButtons = [
    page.locator('.ck-btn--accept').first(),
    page.locator('.cookie-btn--accept-all').first()
  ];

  for (const button of acceptButtons) {
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true });
      await page.locator('.ck-banner').first().waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
      return;
    }
  }
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(
    dimensions.scrollWidth,
    `${label} should not overflow horizontally: ${JSON.stringify(dimensions)}`
  ).toBeLessThanOrEqual(dimensions.width + 1);
}

async function activateAppSection(appShell, testId) {
  await appShell.getByTestId(testId).evaluate((element) => element.click());
}

test.describe('diagnostic visual regression audit', () => {
  test.describe.configure({ mode: 'serial' });

  for (const language of LANGUAGES) {
    for (const viewport of VIEWPORTS) {
      test(`${language} ${viewport.name}: capture landing, auth and app-shell surfaces`, async ({ page }) => {
        test.slow();
        const consoleErrors = [];
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => consoleErrors.push(error.message));

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await bootLanding(page, createDefaultState(), { language });
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:landing`);
        await capture(page, `${language}-${viewport.name}-01-landing`);

        await openEmailAuth(page);
        await expect(page.locator('.auth-modal-drawer')).toBeVisible();
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:auth`);
        await capture(page, `${language}-${viewport.name}-02-auth`);

        await page.getByTestId('auth-modal-close').click({ force: true });
        await expect(page.locator('.auth-shell')).toHaveCount(0);

        await bootLanding(page, createAuthenticatedAuditState(), { language });
        const entered = await enterAppShellFromLanding(page);
        expect(entered).toBe(true);
        const appShell = page.locator('main.page.app-shell');
        await expect(appShell).toBeVisible();
        await dismissCookieBannerIfPresent(page);
        await activateAppSection(appShell, 'app-nav-home');
        await expect(page.getByTestId('opportunity-feed-panel')).toBeVisible();
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:home`);
        await capture(page, `${language}-${viewport.name}-03-home-feed-trial`);

        await activateAppSection(appShell, 'app-nav-radar');
        await expect(page.getByTestId('live-deals-panel')).toBeVisible();
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:radar`);
        await capture(page, `${language}-${viewport.name}-04-radar-live-deals`);

        await activateAppSection(appShell, 'app-nav-ai-travel');
        await expect(page.getByTestId('ai-travel-panel')).toBeVisible();
        await expect(page.getByTestId('triangulation-panel')).toBeVisible();
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:ai-travel`);
        await capture(page, `${language}-${viewport.name}-05-ai-travel-triangulation`);

        await activateAppSection(appShell, 'app-nav-premium');
        await expect(page.getByTestId('premium-panel')).toBeVisible();
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:premium`);
        await capture(page, `${language}-${viewport.name}-06-premium`);

        await activateAppSection(appShell, 'app-nav-home');
        await page.getByTestId('upgrade-cta-pro').click({ force: true });
        await expect(page.getByTestId('upgrade-flow-modal-pro')).toBeVisible();
        await expect(page.getByTestId('upgrade-flow-primary')).toBeVisible();
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:upgrade-modal`);
        await captureLocator(page.getByTestId('upgrade-flow-modal'), `${language}-${viewport.name}-07-upgrade-modal`);

        const unexpectedConsoleErrors = consoleErrors.filter(
          (message) => !/Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i.test(message)
        );
        expect(unexpectedConsoleErrors, `${language}:${viewport.name} unexpected browser console errors`).toEqual([]);
      });
    }
  }
});
