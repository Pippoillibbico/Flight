import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi } from './helpers/app-test-kit';
import en from '../src/i18n/lang/en.js';
import it from '../src/i18n/lang/it.js';
import de from '../src/i18n/lang/de.js';
import fr from '../src/i18n/lang/fr.js';
import es from '../src/i18n/lang/es.js';
import pt from '../src/i18n/lang/pt.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(PROJECT_ROOT, 'src');
const LANGUAGE_PACKS = { en, it, de, fr, es, pt };
const AUDIT_LANGUAGES = ['en', 'it', 'de', 'fr', 'es', 'pt'];
const KNOWN_I18N_KEYS = Object.keys(en?.messages || {});
const KEYLIKE_I18N_TOKENS = KNOWN_I18N_KEYS.filter((key) => /[A-Z_]/.test(key));

function listSourceFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (!/\.(js|jsx|ts|tsx)$/.test(entry.name)) continue;
    files.push(fullPath);
  }
  return files;
}

function extractReferencedI18nKeys() {
  const files = listSourceFiles(SRC_ROOT);
  const keys = new Set();
  const pattern = /\b(?:t|tt)\(\s*'([^']+)'/g;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    let match = pattern.exec(content);
    while (match) {
      const key = String(match[1] || '').trim();
      if (key && !key.includes('${')) keys.add(key);
      match = pattern.exec(content);
    }
  }

  return [...keys].sort();
}

function isTransparentColor(color) {
  const value = String(color || '').toLowerCase().replace(/\s+/g, '');
  return value === 'transparent' || value === 'rgba(0,0,0,0)';
}

async function readVisual(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      color: style.color,
      borderColor: style.borderColor,
      opacity: style.opacity,
      boxShadow: style.boxShadow
    };
  });
}

async function waitForStyleFrame(locator) {
  await locator
    .evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    )
    .catch(() => {});
}

async function assertSolidHover(locator, label, { expectWhiteBackground = false } = {}) {
  await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
  await expect(locator, `${label} should be visible before hover.`).toBeVisible({ timeout: 12000 });

  const before = await readVisual(locator);
  try {
    await locator.hover();
  } catch {
    await locator.hover({ force: true });
  }
  await waitForStyleFrame(locator);
  const after = await readVisual(locator);

  const hasVisibleHoverBackground =
    !isTransparentColor(after.backgroundColor) ||
    (String(after.backgroundImage || '').toLowerCase() !== 'none' && String(after.backgroundImage || '').trim() !== '');
  expect(
    hasVisibleHoverBackground,
    `${label} hover must keep a visible background. before=${before.backgroundColor}, after=${after.backgroundColor}, image=${after.backgroundImage}`
  ).toBe(true);

  expect(Number.parseFloat(after.opacity || '1')).toBeGreaterThanOrEqual(0.99);
  const hoverChanged =
    String(before.backgroundColor || '').trim() !== String(after.backgroundColor || '').trim() ||
    String(before.backgroundImage || '').trim() !== String(after.backgroundImage || '').trim() ||
    String(before.borderColor || '').trim() !== String(after.borderColor || '').trim() ||
    String(before.boxShadow || '').trim() !== String(after.boxShadow || '').trim();
  expect(hoverChanged, `${label} hover should apply a visible state change.`).toBe(true);

  if (expectWhiteBackground) {
    expect(
      String(after.backgroundColor || ''),
      `${label} in light mode must stay white on hover.`
    ).toContain('255, 255, 255');
  }
}

async function runVisibleTextAudit(page, contextLabel) {
  const report = await page.evaluate((knownKeys) => {
    const visibleTextChunks = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const raw = String(node?.nodeValue || '').trim();
      if (!raw) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest('script, style, noscript, template')) continue;
      const style = window.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) continue;
      visibleTextChunks.push(raw.replace(/\s+/g, ' '));
    }

    const allText = visibleTextChunks.join(' ');
    const leakedI18nKeys = knownKeys.filter((key) => allText.includes(key)).slice(0, 40);
    const mojibakeHints = ['â€', 'âœ', 'â–', 'ðŸ', '�'];
    const mojibakeFound = mojibakeHints.filter((token) => allText.includes(token));

    return {
      leakedI18nKeys,
      mojibakeFound,
      sample: allText.slice(0, 800)
    };
  }, knownKeysForLeakAudit());

  expect(
    report.leakedI18nKeys,
    `[${contextLabel}] raw i18n keys are visible in UI: ${report.leakedI18nKeys.join(', ')}`
  ).toEqual([]);
  expect(
    report.mojibakeFound,
    `[${contextLabel}] mojibake text detected in UI: ${report.mojibakeFound.join(', ')}`
  ).toEqual([]);
}

function knownKeysForLeakAudit() {
  return KEYLIKE_I18N_TOKENS;
}

function hasHoverDelta(before, after) {
  return (
    String(before?.backgroundColor || '').trim() !== String(after?.backgroundColor || '').trim() ||
    String(before?.backgroundImage || '').trim() !== String(after?.backgroundImage || '').trim() ||
    String(before?.color || '').trim() !== String(after?.color || '').trim() ||
    String(before?.borderColor || '').trim() !== String(after?.borderColor || '').trim() ||
    String(before?.boxShadow || '').trim() !== String(after?.boxShadow || '').trim()
  );
}

test.describe('Playwright UI/UX/i18n audit suite', () => {
  test('translation coverage: all referenced i18n keys are present in all language packs', async () => {
    const referencedKeys = extractReferencedI18nKeys();

    for (const [lang, pack] of Object.entries(LANGUAGE_PACKS)) {
      const dictionaries = [pack?.messages || {}, pack?.tooltips || {}, pack?.extra || {}];
      const missing = referencedKeys.filter((key) => !dictionaries.some((dictionary) => key in dictionary));
      expect(
        missing,
        `Missing ${missing.length} i18n keys in "${lang}": ${missing.slice(0, 30).join(', ')}`
      ).toEqual([]);
    }
  });

  test('CTA and language dropdown hover remain readable in light and dark themes', async ({ page }) => {
    test.slow();
    await bootLanding(page, createDefaultState(), { language: 'it' });

    const navSignInCta = page.locator('.landing-nav button.landing-accedi-btn').first();
    const heroPrimaryCta = page.locator('.landing-hero-cta > button.landing-cta-primary').first();
    const pricingPrimaryCta = page.locator('.landing-plan-cta.landing-plan-cta-primary').first();

    await assertSolidHover(navSignInCta, 'landing-accedi-btn (dark)');
    await assertSolidHover(heroPrimaryCta, 'landing-cta-primary (dark)');
    await assertSolidHover(pricingPrimaryCta, 'landing-plan-cta-primary (dark)');

    await page.locator('.landing-lang-trigger').click();
    const darkLanguageOption = page.locator('.landing-lang-popover .landing-lang-option:not(.active)').first();
    const darkLanguageBefore = await readVisual(darkLanguageOption);
    await darkLanguageOption.hover({ force: true });
    const darkLanguageHover = await readVisual(darkLanguageOption);
    expect(
      hasHoverDelta(darkLanguageBefore, darkLanguageHover),
      'Language option hover in dark mode should update visual state.'
    ).toBe(true);
    await page.keyboard.press('Escape');

    await page.locator('.landing-theme-btn').click();
    await expect(page.locator('main.landing-shell')).not.toHaveClass(/landing-dark/);

    await assertSolidHover(navSignInCta, 'landing-accedi-btn (light)');
    await assertSolidHover(heroPrimaryCta, 'landing-cta-primary (light)');
    await assertSolidHover(pricingPrimaryCta, 'landing-plan-cta-primary (light)', { expectWhiteBackground: true });

    await page.locator('.landing-lang-trigger').click();
    const lightLanguageOption = page.locator('.landing-lang-popover .landing-lang-option:not(.active)').first();
    const lightLanguageBefore = await readVisual(lightLanguageOption);
    await lightLanguageOption.hover({ force: true });
    const lightLanguageHover = await readVisual(lightLanguageOption);
    expect(
      hasHoverDelta(lightLanguageBefore, lightLanguageHover),
      'Language option hover in light mode should update visual state.'
    ).toBe(true);
    await page.keyboard.press('Escape');
  });

  for (const language of AUDIT_LANGUAGES) {
    test(`functional + label audit (${language})`, async ({ page }) => {
      await bootLanding(page, createDefaultState(), { language });
      await runVisibleTextAudit(page, `landing:${language}`);

      await loginFromUi(page);
      await expect(page.locator('main.page.app-shell')).toBeVisible();
      await runVisibleTextAudit(page, `app-shell:${language}`);

      await page.getByTestId('app-nav-home').click({ force: true });
      await expect(page.locator('.opportunity-feed-panel')).toBeVisible();
      await page.locator('[data-testid^="opportunity-view-"]').first().click();
      await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
      await runVisibleTextAudit(page, `detail:${language}`);

      await page.getByTestId('app-nav-radar').click({ force: true });
      await expect(page.locator('.radar-panel')).toBeVisible();
      const saveRadarResponse = page.waitForResponse((response) => {
        return (
          response.url().includes('/api/opportunities/radar/preferences') &&
          response.request().method() === 'PUT'
        );
      });
      await page.getByTestId('radar-save-preferences').click({ force: true });
      await saveRadarResponse;
      await runVisibleTextAudit(page, `radar:${language}`);

      await page.getByTestId('app-nav-ai-travel').click({ force: true });
      await expect(page.getByTestId('ai-travel-run')).toBeVisible();
      await page.getByTestId('ai-travel-prompt-input').fill('Find me a warm weekend destination from FCO under 450 EUR');
      await page.getByTestId('ai-travel-run').click();
      await expect(page.getByTestId('ai-travel-summary')).toBeVisible();
      await runVisibleTextAudit(page, `ai-travel:${language}`);

      await page.getByTestId('app-nav-premium').click({ force: true });
      await expect(page.locator('[data-testid^="premium-plan-"]')).toHaveCount(3);
      await runVisibleTextAudit(page, `premium:${language}`);
    });
  }

  test('mobile layout: no horizontal overflow on landing and app shell', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootLanding(page, createDefaultState(), { language: 'it' });

    const landingDimensions = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(landingDimensions.scrollWidth).toBeLessThanOrEqual(landingDimensions.width + 1);

    await expect(page.locator('.landing-cta-primary')).toBeVisible();
    await expect(page.locator('.landing-hamburger')).toBeVisible();
    await page.locator('.landing-hamburger').click();
    await expect(page.locator('.landing-mobile-nav .landing-mobile-signin')).toBeVisible();

    await loginFromUi(page);
    await expect(page.locator('main.page.app-shell')).toBeVisible();

    const appDimensions = await page.evaluate(() => {
      const offenders = [];
      for (const node of Array.from(document.querySelectorAll('body *'))) {
        const element = node;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (element.scrollWidth <= element.clientWidth + 1) continue;
        const rect = element.getBoundingClientRect();
        offenders.push({
          tag: element.tagName.toLowerCase(),
          className: element.className,
          id: element.id,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          width: Math.round(rect.width),
          left: Math.round(rect.left),
          right: Math.round(rect.right)
        });
      }
      offenders.sort((left, right) => (right.scrollWidth - right.clientWidth) - (left.scrollWidth - left.clientWidth));
      return {
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        offenders: offenders.slice(0, 12)
      };
    });
    expect(
      appDimensions.scrollWidth,
      `Mobile overflow offenders: ${JSON.stringify(appDimensions.offenders)}`
    ).toBeLessThanOrEqual(appDimensions.width + 1);
    await expect(page.locator('.app-main-nav')).toBeVisible();
  });
});
