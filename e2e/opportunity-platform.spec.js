import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, ensureHomeSection, loginFromUi } from './helpers/app-test-kit';

async function ensureAppShell(page) {
  await page.waitForLoadState('domcontentloaded');
  if (await page.locator('main.landing-shell').isVisible().catch(() => false)) {
    await loginFromUi(page);
  } else {
    const headerAccountButton = page.getByTestId('header-account-button');
    if (await headerAccountButton.isVisible().catch(() => false)) {
      const label = String((await headerAccountButton.textContent()) || '').trim().toLowerCase();
      if (label === 'sign in' || label === 'accedi') {
        await loginFromUi(page);
      }
    }
  }
  await ensureHomeSection(page);
}

async function readTrackedRoutesCount(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('flight_tracked_routes_v1');
    if (!raw) return 0;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return -1;
    }
  });
}

async function ensureJapanUntracked(page) {
  const untrackButton = page.getByTestId('personal-hub-untrack-japan');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if ((await readTrackedRoutesCount(page)) === 0) return;
    if (await untrackButton.isVisible().catch(() => false)) {
      await untrackButton.click({ force: true });
      try {
        await expect.poll(() => readTrackedRoutesCount(page), { timeout: 2000 }).toBe(0);
        return;
      } catch {
        // Retry once on slower browsers.
      }
    }
  }

  const feedToggle = page.getByTestId('opportunity-track-cluster-japan');
  if (await feedToggle.isVisible().catch(() => false)) {
    const label = String((await feedToggle.textContent()) || '').toLowerCase();
    if (label.includes('tracking')) {
      await feedToggle.click({ force: true });
    }
  }
  await expect.poll(() => readTrackedRoutesCount(page)).toBe(0);
}

test.beforeEach(async ({ page }) => {
  await bootLanding(page, createDefaultState());
  await loginFromUi(page);
  await ensureHomeSection(page);
});

test('home feed and detail flow', async ({ page }) => {
  await expect(page.getByTestId('personal-hub-panel')).toBeVisible();
  await expect(page.getByTestId('personal-hub-tracked-empty')).toContainText('No routes tracked yet');
  await expect(page.getByTestId('personal-hub-saved-empty')).toContainText(/No (saved )?itineraries yet/i);
  await expect(page.locator('.opportunity-feed-panel')).toBeVisible();
  await expect(page.getByTestId('opportunity-live-signal')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Flights you shouldn.?t be able to find/ })).toBeVisible();
  await expect(page.getByText(/Our radar (scans|analyses)/)).toBeVisible();
  await expect(page.getByText('Discover incredibly cheap flights before everyone else')).toHaveCount(0);
  await expect(page.getByTestId('opportunity-hero-primary-cta')).toBeVisible();
  await expect(page.getByTestId('opportunity-hero-primary-cta')).toContainText(/Explore live deals|Explore opportunities/);
  await expect(page.getByTestId('opportunity-hero-activate-radar-cta')).toBeVisible();
  await expect(page.getByTestId('opportunity-hero-activate-radar-cta')).toContainText('Activate radar');
  await expect(page.getByTestId('opportunity-hero-refresh-feed-cta')).toBeVisible();
  await expect(page.getByTestId('opportunity-hero-refresh-feed-cta')).toContainText('Refresh feed');
  await expect(page.getByTestId('opportunity-top-deal')).toBeVisible();
  await expect(page.getByTestId('opportunity-top-deal')).toContainText('View deal');
  await expect(page.getByTestId('opportunity-hot-empty')).toBeVisible();
  await expect(page.getByTestId('opportunity-retention-hook-empty')).toContainText('Start tracking routes to unlock your personal radar');
  await expect(page.getByRole('button', { name: 'Follow cluster' })).toHaveCount(0);
  await expect(page.getByTestId('opportunity-track-cluster-japan')).toContainText('Track this route');
  await page.getByTestId('opportunity-track-cluster-japan').click();
  await expect(page.getByTestId('opportunity-track-cluster-japan')).toContainText('Tracking');
  await expect(page.getByTestId('opportunity-retention-hook-returning')).toContainText("You're tracking 1 routes");
  await expect(page.getByTestId('opportunity-top-deal-activity')).toBeVisible();
  await expect(page.getByTestId('opportunity-cluster-activity-japan')).toBeVisible();
  await expect(page.getByTestId('opportunity-activity-opp-1')).toBeVisible();
  await expect(page.getByTestId('opportunity-view-opp-1')).toBeVisible();

  await page.getByTestId('opportunity-top-deal-view').click();

  await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
  await expect(page.locator('.opportunity-detail-panel .panel-head h2')).toBeVisible();
  await expect(page.locator('.opportunity-why-box strong')).toContainText(/\S+/);
});

test('personal hub actions are immediate and persisted locally', async ({ page }) => {
  test.slow();
  await expect(page.getByTestId('personal-hub-radar-inactive')).toContainText('Radar not active');
  await expect(page.getByTestId('personal-hub-tracked-empty')).toBeVisible();

  await page.getByTestId('opportunity-track-cluster-japan').click();
  await expect(page.getByTestId('personal-hub-tracked-route-japan')).toBeVisible();
  await page.getByTestId('personal-hub-view-deals-japan').click();
  await expect(page.getByTestId('opportunity-track-cluster-japan')).toContainText('Tracking');

  await ensureJapanUntracked(page);
  await expect(page.getByTestId('personal-hub-tracked-empty')).toBeVisible();
  await expect(page.getByTestId('opportunity-track-cluster-japan')).toContainText('Track this route');

  await page.getByTestId('opportunity-top-deal-view').click();
  await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
  await page.getByTestId('opportunity-detail-close').click();
  await expect(page.locator('[data-testid^="personal-hub-saved-itinerary-"]')).toHaveCount(1);

  await page.locator('[data-testid^="personal-hub-open-itinerary-"]').first().click();
  await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
  await page.getByTestId('opportunity-detail-close').click();

  await page.getByTestId('personal-hub-activate-radar').click();
  await expect(page.getByTestId('radar-panel')).toBeVisible();
  await page.getByTestId('app-nav-home').click({ force: true });
  await expect(page.getByTestId('personal-hub-radar-active')).toContainText('Radar is active');
});

test('activate radar CTA gives session feedback and highlights radar setup', async ({ page, browserName }) => {
  test.slow();
  await expect(page.getByTestId('opportunity-hero-activate-radar-cta')).toBeVisible();
  await page.getByTestId('opportunity-hero-activate-radar-cta').click();
  await expect(page.getByTestId('radar-panel')).toBeVisible();
  await expect(page.getByTestId('radar-session-message')).toContainText('Radar activated for this session');
  const radarSessionStorageBefore = await page.evaluate(() => window.localStorage.getItem('flight_radar_session_active_v1'));
  expect(radarSessionStorageBefore).toBe('1');
  if (browserName === 'firefox') {
    await page.getByTestId('app-nav-home').click({ force: true });
    await expect(page.getByTestId('opportunity-radar-session-message')).toContainText('Radar activated for this session');
    return;
  } else {
    await page.reload();
    await ensureAppShell(page);
    await expect(page.getByTestId('opportunity-radar-session-message')).toContainText('Radar activated for this session');
  }
  await page.getByTestId('app-nav-radar').click({ force: true });
  await expect(page.getByTestId('radar-session-message')).toContainText('Radar activated for this session');
});

test('top deal section highlights live opportunities when radar_hot deals exist', async ({ page }) => {
  const stateWithHotDeal = createDefaultState();
  stateWithHotDeal.opportunities[0] = { ...stateWithHotDeal.opportunities[0], radarState: 'radar_hot' };
  await page.route('**/api/opportunities/feed**', async (route) => {
    const body = {
      items: stateWithHotDeal.opportunities,
      access: stateWithHotDeal.feedAccess
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
  await page.getByTestId('opportunity-hero-refresh-feed-cta').click();
  await expect(page.getByTestId('opportunity-hot-state')).toContainText('Live opportunities detected');
  await expect(page.getByTestId('opportunity-top-deal')).toContainText('Likely to disappear soon');
});

test('tracked routes persist after refresh via localStorage', async ({ page, browserName }) => {
  await expect(page.getByTestId('opportunity-track-cluster-japan')).toContainText('Track this route');
  await page.getByTestId('opportunity-track-cluster-japan').click();
  await expect(page.getByTestId('opportunity-track-cluster-japan')).toContainText('Tracking');
  const trackedRoutesStorageBefore = await page.evaluate(() => window.localStorage.getItem('flight_tracked_routes_v1'));
  expect(String(trackedRoutesStorageBefore || '')).toContain('japan');
  if (browserName === 'firefox') {
    await page.getByTestId('app-nav-radar').click({ force: true });
    await page.getByTestId('app-nav-home').click({ force: true });
  } else {
    await page.reload();
    await ensureAppShell(page);
    if ((await page.getByTestId('opportunity-track-cluster-japan').count()) === 0) {
      await page.getByTestId('app-nav-home').click({ force: true });
    }
  }
  await expect(page.getByTestId('opportunity-track-cluster-japan')).toContainText('Tracking');
  await expect(page.getByTestId('opportunity-retention-hook-returning')).toContainText("You're tracking 1 routes");
});

test('radar preferences save flow', async ({ page }) => {
  await page.getByTestId('app-nav-radar').click({ force: true });

  await expect(page.locator('.radar-panel')).toBeVisible();
  await page.locator('.radar-panel input[type="number"]').first().fill('450');
  const saveResponse = page.waitForResponse((response) => {
    return (
      response.url().includes('/api/opportunities/radar/preferences') &&
      response.request().method() === 'PUT' &&
      response.status() === 200
    );
  });
  await page.getByTestId('radar-save-preferences').click({ force: true });
  await saveResponse;
  await expect(page.locator('.radar-panel input[type="number"]').first()).toHaveValue('450');
});

test('ai travel query flow', async ({ page }) => {
  await page.getByTestId('app-nav-ai-travel').click({ force: true });
  await page.locator('.ai-intake-box').fill('Tokyo da Roma con 500 euro a novembre');
  await page.getByRole('button', { name: /Ask AI|Chiedi all'AI/i }).click();
  await expect(page.getByText(/Found \d+ real opportunities\.|Trovate \d+ opportunita reali\./i)).toBeVisible();

  await page.getByRole('button', { name: /View itinerary|Vedi itinerario/i }).first().click();
  await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
});

test('premium tab renders plan cards', async ({ page }) => {
  await page.getByTestId('app-nav-premium').click({ force: true });

  await expect(page.getByTestId('premium-plan-free')).toBeVisible();
  await expect(page.getByTestId('premium-plan-pro')).toBeVisible();
  await expect(page.getByTestId('premium-plan-elite')).toBeVisible();
  await expect(page.getByTestId('premium-plan-pro')).toContainText(/7/i);
  await expect(page.getByTestId('premium-plan-elite')).toContainText(/19/i);
  await expect(page.getByTestId('premium-upgrade-pro')).toBeVisible();
  await expect(page.getByTestId('premium-upgrade-elite')).toBeVisible();
});

test('mobile home feed keeps premium hero and top-deal layout without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.getByTestId('opportunity-feed-panel')).toBeVisible();
  await expect(page.getByTestId('opportunity-live-signal')).toBeVisible();
  await expect(page.getByTestId('opportunity-top-deal')).toBeVisible();

  const hasOverflow = await page.getByTestId('opportunity-feed-panel').evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(hasOverflow).toBe(false);
});
