import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, enterAppShellFromLanding, openEmailAuth } from './helpers/app-test-kit';

const SCREENSHOT_DIR = path.resolve('test-results', 'visual-i18n-secondary-languages');
const LANGUAGES = ['de', 'fr', 'es', 'pt'];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];
const RAW_I18N_KEY_PATTERN = /\b(?:upgradePrompt|triangulation|opportunityFeed|trialBanner|landing|radar)[A-Z][A-Za-z0-9]+\b/g;
const MOJIBAKE_PATTERN = /(?:Ã[^A-Za-z0-9\s]|Â[^A-Za-z0-9\s]|â(?:€|†|‚|š|œ|ž)|ï¿½|\uFFFD)/g;

function createAuthenticatedFreeState() {
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
    }
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

async function activateSection(appShell, testId) {
  await appShell.getByTestId(testId).evaluate((element) => element.click());
}

async function dismissCookieBannerIfPresent(page) {
  const acceptButton = page.locator('.ck-btn--accept, .cookie-btn--accept-all').first();
  if (!(await acceptButton.isVisible().catch(() => false))) return;
  await acceptButton.click({ force: true });
  await page.locator('.ck-banner').waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
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

async function assertReadableVisibleText(page, label) {
  const text = await page.locator('body').innerText();
  const rawKeys = [...new Set(text.match(RAW_I18N_KEY_PATTERN) || [])];
  const mojibake = [...new Set(text.match(MOJIBAKE_PATTERN) || [])];
  expect(rawKeys, `${label} exposes raw i18n keys: ${rawKeys.join(', ')}`).toEqual([]);
  expect(mojibake, `${label} exposes mojibake: ${mojibake.join(', ')}`).toEqual([]);
}

async function assertPrimaryActionsReadable(page, label) {
  const actions = page.locator('button:visible, a:visible');
  const count = await actions.count();
  expect(count, `${label} should expose at least one visible action`).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const action = actions.nth(index);
    const report = await action.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        text: String(element.textContent || '').trim(),
        width: rect.width,
        height: rect.height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        display: style.display,
        visibility: style.visibility
      };
    });
    if (!report.text) continue;
    expect(
      report.scrollWidth,
      `${label} clips action text "${report.text}": ${JSON.stringify(report)}`
    ).toBeLessThanOrEqual(report.clientWidth + 1);
    expect(
      report.scrollHeight,
      `${label} clips action height "${report.text}": ${JSON.stringify(report)}`
    ).toBeLessThanOrEqual(report.clientHeight + 1);
  }
}

test.describe('secondary-language visual i18n matrix', () => {
  test.describe.configure({ mode: 'serial' });

  for (const language of LANGUAGES) {
    for (const viewport of VIEWPORTS) {
      test(`${language} ${viewport.name}: core surfaces remain readable`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await bootLanding(page, createDefaultState(), { language });
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:landing`);
        await assertReadableVisibleText(page, `${language}:${viewport.name}:landing`);
        await assertPrimaryActionsReadable(page, `${language}:${viewport.name}:landing`);
        await capture(page, `${language}-${viewport.name}-01-landing`);

        await openEmailAuth(page);
        await expect(page.locator('.auth-modal-drawer')).toBeVisible();
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:auth`);
        await assertReadableVisibleText(page, `${language}:${viewport.name}:auth`);
        await capture(page, `${language}-${viewport.name}-02-auth`);

        await bootLanding(page, createAuthenticatedFreeState(), { language });
        expect(await enterAppShellFromLanding(page)).toBe(true);
        const appShell = page.locator('main.page.app-shell');
        await expect(appShell).toBeVisible();
        await dismissCookieBannerIfPresent(page);

        await activateSection(appShell, 'app-nav-home');
        await expect(page.getByTestId('opportunity-feed-panel')).toBeVisible();
        await expect(page.locator('body')).not.toContainText('Live provider mode active. Radar is scanning current fares.');
        await expect(page.locator('body')).not.toContainText('Connected to live providers.');
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:feed`);
        await assertReadableVisibleText(page, `${language}:${viewport.name}:feed`);
        await capture(page, `${language}-${viewport.name}-03-home-feed-trial`);

        await activateSection(appShell, 'app-nav-radar');
        await expect(page.getByTestId('live-deals-panel')).toBeVisible();
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:radar`);
        await assertReadableVisibleText(page, `${language}:${viewport.name}:radar`);
        await capture(page, `${language}-${viewport.name}-04-radar-live-deals`);

        await activateSection(appShell, 'app-nav-ai-travel');
        await expect(page.getByTestId('triangulation-panel')).toBeVisible();
        await page.getByTestId('triangulation-run').click();
        await expect(page.getByTestId('triangulation-preview-list')).toBeVisible();
        await expect(page.getByTestId('triangulation-panel')).not.toContainText('Preview Free');
        await expect(page.getByTestId('triangulation-panel')).not.toContainText(
          'Broader premium access, full radar coverage, and richer value visibility.'
        );
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:triangulation`);
        await assertReadableVisibleText(page, `${language}:${viewport.name}:triangulation`);
        await capture(page, `${language}-${viewport.name}-05-ai-travel-triangulation-preview`);

        await page.getByTestId('upgrade-cta-pro').first().click({ force: true });
        await expect(page.getByTestId('upgrade-flow-modal-pro')).toBeVisible();
        await assertNoHorizontalOverflow(page, `${language}:${viewport.name}:upgrade-modal`);
        await assertReadableVisibleText(page, `${language}:${viewport.name}:upgrade-modal`);
        await assertPrimaryActionsReadable(page, `${language}:${viewport.name}:upgrade-modal`);
        await captureLocator(
          page.getByTestId('upgrade-flow-modal'),
          `${language}-${viewport.name}-06-upgrade-modal`
        );
      });
    }
  }
});
