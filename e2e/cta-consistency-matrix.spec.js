import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, enterAppShellFromLanding } from './helpers/app-test-kit';

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isTransparentColor(color) {
  const value = normalizeText(color).replace(/\s+/g, '');
  return value === 'transparent' || value === 'rgba(0,0,0,0)';
}

function colorKey(color) {
  const values = String(color || '')
    .match(/[\d.]+/g)
    ?.map((chunk) => Number.parseFloat(chunk))
    .filter((chunk) => Number.isFinite(chunk)) || [];
  if (values.length < 3) return 'none';
  const [r, g, b, a = 1] = values;
  return [
    Math.round(r),
    Math.round(g),
    Math.round(b),
    Math.round(a * 100) / 100
  ].join(',');
}

async function readVisual(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      color: style.color,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      opacity: style.opacity,
      cursor: style.cursor
    };
  });
}

async function waitForStyleFrame(target) {
  await target
    .evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    )
    .catch(() => {});
}

function hasVisibleBackground(style) {
  return (
    !isTransparentColor(style.backgroundColor) ||
    (normalizeText(style.backgroundImage) !== 'none' && String(style.backgroundImage || '').trim() !== '')
  );
}

async function readHoverVisual(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const element = await locator.elementHandle();
  if (!element) {
    throw new Error('Unable to resolve CTA element handle for hover visual audit.');
  }
  const readElementVisual = async () =>
    element.evaluate((target) => {
      const style = window.getComputedStyle(target);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        color: style.color,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
        opacity: style.opacity,
        cursor: style.cursor
      };
    });
  const baseVisual = await readElementVisual();
  try {
    await element.hover();
  } catch {
    await element.hover({ force: true });
  }
  await waitForStyleFrame(element);
  let visual = await readElementVisual();
  if (!hasVisibleBackground(visual)) {
    await element.hover({ force: true });
    await waitForStyleFrame(element);
    visual = await readElementVisual();
  }
  expect(
    hasVisibleBackground(visual),
    `CTA hover must keep visible background: ${JSON.stringify(visual)}`
  ).toBe(true);
  expect(Number.parseFloat(visual.opacity || '1')).toBeGreaterThanOrEqual(0.99);
  const changedOnHover =
    colorKey(baseVisual.backgroundColor) !== colorKey(visual.backgroundColor) ||
    normalizeText(baseVisual.backgroundImage) !== normalizeText(visual.backgroundImage) ||
    colorKey(baseVisual.borderColor) !== colorKey(visual.borderColor) ||
    normalizeText(baseVisual.boxShadow) !== normalizeText(visual.boxShadow) ||
    colorKey(baseVisual.color) !== colorKey(visual.color);
  expect(changedOnHover, `CTA hover should update visual state: ${JSON.stringify({ baseVisual, visual })}`).toBe(true);
  if (normalizeText(visual.backgroundImage) === 'none' && !isTransparentColor(visual.backgroundColor)) {
    expect(
      colorKey(visual.color),
      `CTA hover text must remain readable against background: ${JSON.stringify(visual)}`
    ).not.toBe(colorKey(visual.backgroundColor));
  }
  return visual;
}

async function readActiveVisual(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Cannot read bounding box for active visual assertion.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const visual = await readVisual(locator);
  await page.mouse.up();
  return visual;
}

async function focusWithKeyboard(page, locator, maxTabs = 40) {
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press('Tab');
    const focused = await locator.evaluate((element) => element === document.activeElement);
    if (focused) return true;
  }
  return false;
}

async function disableTransitions(page) {
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        transition: none !important;
        animation: none !important;
      }
    `
  });
}

async function ensureHomeSectionVisible(page) {
  const homeTab = page.getByTestId('app-nav-home');
  if (await homeTab.isVisible().catch(() => false)) {
    await homeTab.click({ force: true });
  }
  await expect(page.getByTestId('opportunity-hero-primary-cta')).toBeVisible();
}

async function bootAuthenticatedAppShell(page, { language = 'en' } = {}) {
  await bootLanding(page, createDefaultState(), { language });
  const entered = await enterAppShellFromLanding(page, { timeoutMs: 15000 });
  expect(entered).toBe(true);
  await expect(page.locator('main.page.app-shell')).toBeVisible();
}

async function assertLanguageOptionHover(page) {
  await page.locator('.landing-lang-trigger').click();
  const option = page.locator('.landing-lang-popover .landing-lang-option:not(.active)').first();
  const hover = await readHoverVisual(option);
  expect(isTransparentColor(hover.backgroundColor)).toBe(false);
  await page.keyboard.press('Escape');
}

test.describe('CTA consistency matrix', () => {
  test('landing dark: primary/secondary families are internally consistent + focus/active', async ({ page }) => {
    test.slow();
    await bootLanding(page, createDefaultState(), { language: 'en' });
    await disableTransitions(page);
    await expect(page.locator('main.landing-shell')).toHaveClass(/landing-dark/);

    const signIn = page.locator('.landing-nav .landing-accedi-btn').first();
    const heroPrimary = page.locator('.landing-hero-cta .landing-cta-primary').first();
    const heroGhost = page.locator('.landing-hero-cta .landing-cta-ghost').first();
    const themeButton = page.locator('.landing-nav .landing-theme-btn').first();
    const pricingPrimary = page.locator('.landing-plan-cta.landing-plan-cta-primary').first();
    const pricingGhost = page.locator('.landing-plan-cta.ghost').first();

    const signInHover = await readHoverVisual(signIn);
    const heroPrimaryHover = await readHoverVisual(heroPrimary);
    expect(hasVisibleBackground(signInHover)).toBe(true);
    expect(hasVisibleBackground(heroPrimaryHover)).toBe(true);

    const heroGhostHover = await readHoverVisual(heroGhost);
    const themeHover = await readHoverVisual(themeButton);
    const pricingGhostHover = await readHoverVisual(pricingGhost);
    expect(isTransparentColor(pricingGhostHover.backgroundColor)).toBe(false);
    expect(isTransparentColor(themeHover.backgroundColor)).toBe(false);

    const pricingPrimaryHover = await readHoverVisual(pricingPrimary);
    expect(
      colorKey(pricingPrimaryHover.backgroundColor),
      'landing dark pricing primary must stay on readable light surface on hover'
    ).toContain('255,255,255');
    expect(colorKey(pricingPrimaryHover.color)).not.toBe(colorKey(pricingPrimaryHover.backgroundColor));

    await assertLanguageOptionHover(page);

    const focusReached = await focusWithKeyboard(page, page.locator('.landing-nav .landing-nav-link').first());
    expect(focusReached, 'landing focus-visible target should be reachable via keyboard tabbing').toBe(true);
    const focusVisual = await readVisual(page.locator('.landing-nav .landing-nav-link').first());
    expect(normalizeText(focusVisual.boxShadow)).not.toBe('none');

    const activeVisual = await readActiveVisual(page, signIn);
    expect(
      hasVisibleBackground(activeVisual),
      'landing dark active state should keep a visible surface'
    ).toBe(true);
  });

  test('landing light: primary/secondary families are internally consistent + plan CTA stays white', async ({ page }) => {
    test.slow();
    await bootLanding(page, createDefaultState(), { language: 'en' });
    await disableTransitions(page);
    await page.locator('.landing-theme-btn').click();
    await expect(page.locator('main.landing-shell')).not.toHaveClass(/landing-dark/);

    const signIn = page.locator('.landing-nav .landing-accedi-btn').first();
    const heroPrimary = page.locator('.landing-hero-cta .landing-cta-primary').first();
    const heroGhost = page.locator('.landing-hero-cta .landing-cta-ghost').first();
    const themeButton = page.locator('.landing-nav .landing-theme-btn').first();
    const pricingPrimary = page.locator('.landing-plan-cta.landing-plan-cta-primary').first();
    const pricingGhost = page.locator('.landing-plan-cta.ghost').first();

    const signInHover = await readHoverVisual(signIn);
    const heroPrimaryHover = await readHoverVisual(heroPrimary);
    expect(hasVisibleBackground(signInHover)).toBe(true);
    expect(hasVisibleBackground(heroPrimaryHover)).toBe(true);

    const heroGhostHover = await readHoverVisual(heroGhost);
    const themeHover = await readHoverVisual(themeButton);
    const pricingGhostHover = await readHoverVisual(pricingGhost);
    expect(isTransparentColor(pricingGhostHover.backgroundColor)).toBe(false);
    expect(isTransparentColor(themeHover.backgroundColor)).toBe(false);

    const pricingPrimaryHover = await readHoverVisual(pricingPrimary);
    expect(
      colorKey(pricingPrimaryHover.backgroundColor),
      'landing light pricing primary must remain white on hover'
    ).toContain('255,255,255');
    expect(colorKey(pricingPrimaryHover.color)).not.toBe(colorKey(pricingPrimaryHover.backgroundColor));

    await assertLanguageOptionHover(page);
  });

  test('app dark: CTA matrix is consistent + disabled has no hover behavior', async ({ page }) => {
    test.slow();
    await bootAuthenticatedAppShell(page, { language: 'en' });
    await disableTransitions(page);
    await expect(page.locator('main.page.app-shell')).toHaveClass(/app-dark/);
    await ensureHomeSectionVisible(page);

    const heroPrimary = page.getByTestId('opportunity-hero-primary-cta');
    const heroSecondary = page.getByTestId('opportunity-hero-activate-radar-cta');
    const refreshSecondary = page.getByTestId('opportunity-hero-refresh-feed-cta');
    const mainNavExplore = page.getByTestId('app-nav-explore');
    const appThemeButton = page.locator('.hero-controls .landing-theme-btn').first();

    await readHoverVisual(heroPrimary);
    await readHoverVisual(heroSecondary);
    await expect(refreshSecondary).toBeEnabled();
    const refreshHover = await readHoverVisual(refreshSecondary);
    const tabHover = await readHoverVisual(mainNavExplore);
    const themeHover = await readHoverVisual(appThemeButton);
    expect(isTransparentColor(refreshHover.backgroundColor)).toBe(false);
    expect(isTransparentColor(tabHover.backgroundColor)).toBe(false);
    expect(isTransparentColor(themeHover.backgroundColor)).toBe(false);

    await refreshSecondary.evaluate((element) => {
      const button = element;
      button.disabled = true;
    });
    const disabledBeforeHover = await readVisual(refreshSecondary);
    await refreshSecondary.hover({ force: true });
    const disabledAfterHover = await readVisual(refreshSecondary);
    expect(colorKey(disabledAfterHover.backgroundColor)).toBe(colorKey(disabledBeforeHover.backgroundColor));
    expect(colorKey(disabledAfterHover.borderColor)).toBe(colorKey(disabledBeforeHover.borderColor));
    expect(normalizeText(disabledAfterHover.cursor)).toBe('not-allowed');

    const activePrimary = await readActiveVisual(page, heroPrimary);
    expect(
      hasVisibleBackground(activePrimary),
      'app dark primary active state should keep a visible surface'
    ).toBe(true);
  });

  test('app light: CTA matrix is consistent', async ({ page }) => {
    test.slow();
    await bootAuthenticatedAppShell(page, { language: 'en' });
    await disableTransitions(page);
    await page.locator('.hero-controls .landing-theme-btn').click();
    await expect(page.locator('main.page.app-shell')).not.toHaveClass(/app-dark/);
    await ensureHomeSectionVisible(page);

    const heroPrimary = page.getByTestId('opportunity-hero-primary-cta');
    const heroSecondary = page.getByTestId('opportunity-hero-activate-radar-cta');
    const refreshSecondary = page.getByTestId('opportunity-hero-refresh-feed-cta');
    const mainNavExplore = page.getByTestId('app-nav-explore');
    const appThemeButton = page.locator('.hero-controls .landing-theme-btn').first();

    await readHoverVisual(heroPrimary);
    await readHoverVisual(heroSecondary);
    await expect(refreshSecondary).toBeEnabled();
    const refreshHover = await readHoverVisual(refreshSecondary);
    const tabHover = await readHoverVisual(mainNavExplore);
    const themeHover = await readHoverVisual(appThemeButton);
    expect(isTransparentColor(refreshHover.backgroundColor)).toBe(false);
    expect(isTransparentColor(tabHover.backgroundColor)).toBe(false);
    expect(isTransparentColor(themeHover.backgroundColor)).toBe(false);

    const activePrimary = await readActiveVisual(page, heroPrimary);
    expect(
      hasVisibleBackground(activePrimary),
      'app light primary active state should keep a visible surface'
    ).toBe(true);
    expect(
      colorKey(activePrimary.color),
      'app light primary active state should keep readable contrast'
    ).not.toBe(colorKey(activePrimary.backgroundColor));
  });
});
