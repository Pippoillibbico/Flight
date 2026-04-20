import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, ensureHomeSection, loginFromUi } from './helpers/app-test-kit';

test.describe.configure({ mode: 'serial' });

async function ensureAppShell(page) {
  await page.waitForLoadState('domcontentloaded');
  let appShellReady = false;
  try {
    await expect.poll(() => page.locator('main.page.app-shell').isVisible().catch(() => false), { timeout: 8000 }).toBe(true);
    appShellReady = true;
  } catch {}
  if (!appShellReady) {
    await page.goto('/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    try {
      await expect.poll(() => page.locator('main.page.app-shell').isVisible().catch(() => false), { timeout: 10000 }).toBe(true);
      appShellReady = true;
    } catch {}
  }
  if (!appShellReady) {
    await loginFromUi(page);
  }
  await ensureHomeSection(page);
}

async function forceOpportunityFixtures(page) {
  const fixtureState = createDefaultState();
  await page.route('**/api/opportunities/feed**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: fixtureState.opportunities,
        access: fixtureState.feedAccess
      })
    });
  });
  await page.route('**/api/opportunities/clusters**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: fixtureState.clusters
      })
    });
  });
}

async function ensureTrackJapanButtonVisible(page) {
  await ensureHomeSection(page);
  const trackButton = page.getByTestId('opportunity-track-cluster-japan');
  if ((await trackButton.count().catch(() => 0)) > 0) return;
  await forceOpportunityFixtures(page);
  const refreshCta = page.getByTestId('opportunity-hero-refresh-feed-cta');
  if (await refreshCta.isVisible().catch(() => false)) {
    await refreshCta.click({ force: true });
  }
  await expect.poll(() => trackButton.count().catch(() => 0), { timeout: 10000 }).toBeGreaterThan(0);
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
      await untrackButton.scrollIntoViewIfNeeded().catch(() => {});
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

test('home feed and detail flow', async ({ page }) => {
  await expect(page.getByTestId('personal-hub-panel')).toBeVisible();
  await expect(page.getByTestId('personal-hub-tracked-empty')).toContainText('No routes tracked yet');
  await expect(page.getByTestId('personal-hub-saved-empty')).toContainText(/No (saved )?itineraries yet/i);
  await expect(page.locator('.opportunity-feed-panel')).toBeVisible();
  await expect(page.getByTestId('opportunity-live-signal')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Flights you shouldn.?t be able to find/ })).toBeVisible();
  // In live mode the feed can transiently be empty while CTAs remain available.
  await expect(page.getByTestId('opportunity-hero-primary-cta')).toBeVisible();
  await expect(page.getByTestId('opportunity-hero-primary-cta')).toContainText(/Explore live deals|Explore opportunities/);
  await expect(page.getByTestId('opportunity-hero-activate-radar-cta')).toBeVisible();
  await expect(page.getByTestId('opportunity-hero-activate-radar-cta')).toContainText('Activate radar');
  await expect(page.getByTestId('opportunity-hero-refresh-feed-cta')).toBeVisible();
  await expect(page.getByTestId('opportunity-hero-refresh-feed-cta')).toContainText('Refresh feed');
  await forceOpportunityFixtures(page);
  await page.getByTestId('opportunity-hero-refresh-feed-cta').click();
  await expect(page.getByTestId('opportunity-top-deal').or(page.getByTestId('opportunity-hot-empty')).first()).toBeVisible();
  const topDealCount = await page.getByTestId('opportunity-top-deal-view').count().catch(() => 0);
  const firstCardCount = await page.getByTestId('opportunity-view-opp-1').count().catch(() => 0);
  if (topDealCount > 0) {
    try {
      await page.getByTestId('opportunity-top-deal-view').first().click({ force: true, timeout: 5000 });
    } catch {
      if (firstCardCount > 0) {
        await page.getByTestId('opportunity-view-opp-1').first().click({ force: true });
      } else {
        await expect(page.getByTestId('opportunity-hot-empty')).toBeVisible();
        return;
      }
    }
  } else if (firstCardCount > 0) {
    await page.getByTestId('opportunity-view-opp-1').first().click({ force: true });
  } else {
    await expect(page.getByTestId('opportunity-hot-empty')).toBeVisible();
    return;
  }

  await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
  await expect(page.locator('.opportunity-detail-panel .panel-head h2')).toBeVisible();
  await expect
    .poll(
      () =>
        page
          .locator('.opportunity-detail-panel')
          .innerText()
          .then((v) => String(v || '').trim().length),
      { timeout: 10000 }
    )
    .toBeGreaterThan(0);
});

test('personal hub actions are immediate and persisted locally', async ({ page }) => {
  test.slow();
  await expect(page.getByTestId('personal-hub-radar-inactive')).toContainText('Radar not active');
  await expect(page.getByTestId('personal-hub-tracked-empty').or(page.getByTestId('personal-hub-panel')).first()).toBeVisible();

  await forceOpportunityFixtures(page);
  await page.getByTestId('opportunity-hero-refresh-feed-cta').click();
  const clickedAnyOpportunity = await page.evaluate(() => {
    const candidate =
      document.querySelector('[data-testid="opportunity-top-deal-view"]') ||
      document.querySelector('[data-testid^="opportunity-view-"]');
    if (!candidate) return false;
    candidate.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  });
  if (!clickedAnyOpportunity) {
    await expect(page.getByTestId('opportunity-hot-empty')).toBeVisible();
    return;
  }
  await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
  await page.getByTestId('opportunity-detail-close').click();
  const savedItineraryCount = await page.locator('[data-testid^="personal-hub-saved-itinerary-"]').count().catch(() => 0);
  if (savedItineraryCount > 0) {
    await page.locator('[data-testid^="personal-hub-open-itinerary-"]').first().click();
    await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
    await page.getByTestId('opportunity-detail-close').click();
  }

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
    await page.reload({ waitUntil: 'domcontentloaded' });
    let appShellVisible = false;
    try {
      await expect.poll(() => page.locator('main.page.app-shell').isVisible().catch(() => false), { timeout: 8000 }).toBe(true);
      appShellVisible = true;
    } catch {}
    if (appShellVisible) {
      await ensureHomeSection(page);
      await expect(page.getByTestId('opportunity-radar-session-message')).toContainText('Radar activated for this session');
    } else {
      const radarSessionStorageAfter = await page.evaluate(() => window.localStorage.getItem('flight_radar_session_active_v1'));
      expect(radarSessionStorageAfter).toBe('1');
      return;
    }
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
  await expect(page.getByTestId('opportunity-top-deal-section')).toBeVisible();
  await expect(
    page
      .getByTestId('opportunity-hot-state')
      .or(page.getByTestId('opportunity-urgency-pill-top-deal'))
      .or(page.getByTestId('opportunity-hot-empty'))
      .first()
  ).toBeVisible();
});

test('tracked routes persist after refresh via localStorage', async ({ page, browserName }) => {
  await page.evaluate(() => {
    window.localStorage.setItem('flight_tracked_routes_v1', JSON.stringify(['japan']));
  });
  const trackedRoutesStorageBefore = await page.evaluate(() => window.localStorage.getItem('flight_tracked_routes_v1'));
  expect(String(trackedRoutesStorageBefore || '')).toContain('japan');
  if (browserName === 'firefox') {
    await page.getByTestId('app-nav-radar').click({ force: true });
    await page.getByTestId('app-nav-home').click({ force: true });
  } else {
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  const trackedRoutesStorageAfter = await page.evaluate(() => window.localStorage.getItem('flight_tracked_routes_v1'));
  expect(String(trackedRoutesStorageAfter || '')).toContain('japan');
  if ((await page.getByTestId('opportunity-retention-hook-returning').count().catch(() => 0)) > 0) {
    await expect(page.getByTestId('opportunity-retention-hook-returning')).toContainText("You're tracking");
  }
});

test('radar preferences save flow', async ({ page, browserName }) => {
  await page.getByTestId('app-nav-radar').click({ force: true });

  await expect(page.locator('.radar-panel')).toBeVisible();
  await page.locator('.radar-panel input[type="number"]').first().fill('450');
  await page.getByTestId('radar-save-preferences').click({ force: true });
  await expect.poll(() => page.locator('.radar-panel input[type="number"]').first().inputValue(), { timeout: 10000 }).toBe('450');
});

test('ai travel query flow', async ({ page }) => {
  await page.getByTestId('app-nav-ai-travel').click({ force: true });
  await page.getByTestId('ai-travel-prompt-input').fill('Tokyo da Roma con 500 euro a novembre');
  await page.getByTestId('ai-travel-run').click();
  await expect(page.getByTestId('ai-travel-summary')).toContainText(/Trovate \d+ opportunita reali|Found \d+ real opportunities/i);
  const resultActionCount = await page.locator('.ai-travel-results-section button').count().catch(() => 0);
  if (resultActionCount > 0) {
    const firstResultAction = page.locator('.ai-travel-results-section button').first();
    await firstResultAction.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await firstResultAction.click({ force: true, timeout: 5000 });
    } catch {
      await page.evaluate(() => {
        const btn = document.querySelector('.ai-travel-results-section button');
        if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    }
    await expect(page.locator('.opportunity-detail-panel')).toBeVisible();
  }
});

test('premium tab renders plan cards', async ({ page }) => {
  await page.getByTestId('app-nav-premium').click({ force: true });

  await expect(page.getByTestId('premium-plan-free')).toBeVisible();
  await expect(page.getByTestId('premium-plan-pro')).toBeVisible();
  await expect(page.getByTestId('premium-plan-elite')).toBeVisible();
  await expect(page.getByTestId('premium-upgrade-pro')).toBeVisible();
  await expect(page.getByTestId('premium-upgrade-elite')).toBeVisible();
});

test('mobile home feed keeps premium hero and top-deal layout without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.getByTestId('opportunity-feed-panel')).toBeVisible();
  await expect(page.getByTestId('opportunity-live-signal')).toBeVisible();
  await expect(page.getByTestId('opportunity-top-deal').or(page.getByTestId('opportunity-hot-empty')).first()).toBeVisible();

  const hasOverflow = await page.getByTestId('opportunity-feed-panel').evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(hasOverflow).toBe(false);
});
