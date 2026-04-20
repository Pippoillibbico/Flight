import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, ensureHomeSection, loginFromUi } from './helpers/app-test-kit';

test.describe.configure({ mode: 'serial' });

function parseRgb(value) {
  const match = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance(rgb) {
  const channel = (x) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
}

test.beforeEach(async ({ page }) => {
  await bootLanding(page, createDefaultState({ isLoggedIn: true }));
  let appShellVisible = false;
  try {
    await expect.poll(() => page.locator('main.page.app-shell').isVisible().catch(() => false), { timeout: 10000 }).toBe(true);
    appShellVisible = true;
  } catch {}
  if (!appShellVisible) {
    await loginFromUi(page);
  }
  await ensureHomeSection(page);
});

test('home renders real feed and clusters without empty-state fallback', async ({ page }) => {
  await expect(page.locator('.opportunity-feed-panel')).toBeVisible();
  await expect(page.getByTestId('opportunity-live-signal')).toBeVisible();
  await expect(page.getByTestId('opportunity-hero-refresh-feed-cta')).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: /opportunity clusters|discover by cluster/i })).toBeVisible();
});

test('account panel keeps readable contrast in dark mode', async ({ page }) => {
  const darkToggle = page.getByRole('button', { name: /dark|light/i }).first();
  if (await darkToggle.isVisible()) {
    await darkToggle.click();
  }

  await page.getByRole('button', { name: /test user/i }).click();
  await expect(page.locator('.auth-account-panel')).toBeVisible();

  const backgroundColor = await page.locator('.account-user-box').evaluate((el) => getComputedStyle(el).backgroundColor);
  const textColor = await page.locator('.account-user-box strong').first().evaluate((el) => getComputedStyle(el).color);

  const background = parseRgb(backgroundColor);
  const foreground = parseRgb(textColor);
  expect(background).not.toBeNull();
  expect(foreground).not.toBeNull();
  const ratio = contrastRatio(background, foreground);
  expect(ratio).toBeGreaterThan(4.5);
});
