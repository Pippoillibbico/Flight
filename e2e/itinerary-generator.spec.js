import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi } from './helpers/app-test-kit';

function buildGeneratorFixtureItems() {
  return [
    {
      id: 'gen-mid',
      origin_airport: 'FCO',
      destination_city: 'Athens',
      destination_airport: 'ATH',
      price: 240,
      currency: 'EUR',
      depart_date: '2026-10-10',
      return_date: '2026-10-16',
      stops: 0,
      comfort_score: 78,
      final_score: 80,
      dealPriority: 3,
      radarPriority: 2
    },
    {
      id: 'gen-low',
      origin_airport: 'FCO',
      destination_city: 'Cairo',
      destination_airport: 'CAI',
      price: 340,
      currency: 'EUR',
      depart_date: '2026-10-12',
      return_date: '2026-10-18',
      stops: 2,
      comfort_score: 52,
      final_score: 55,
      dealPriority: 1,
      radarPriority: 1
    },
    {
      id: 'gen-top',
      origin_airport: 'FCO',
      destination_city: 'Lisbon',
      destination_airport: 'LIS',
      price: 210,
      currency: 'EUR',
      depart_date: '2026-10-08',
      return_date: '2026-10-14',
      stops: 0,
      comfort_score: 90,
      final_score: 92,
      dealPriority: 4,
      radarPriority: 3
    }
  ];
}

async function mockGeneratorFeed(page, items) {
  await page.route('**/api/opportunities/feed**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items,
        access: {
          showUpgradePrompt: false,
          remainingToday: null,
          upgradeMessage: 'Unlock all opportunities with PRO'
        }
      })
    });
  });
}

async function openAiTravelAndRun(page, prompt = 'Find value-focused trips from FCO') {
  await page.getByRole('button', { name: 'AI Travel', exact: true }).click();
  await page.getByTestId('ai-travel-prompt-input').fill(prompt);
  await page.getByTestId('ai-travel-run').click();
}

test('AI Travel generator shows ranked deterministic suggestions from stable fixture data', async ({ page }) => {
  await bootLanding(page, createDefaultState(), { language: 'en' });
  await mockGeneratorFeed(page, buildGeneratorFixtureItems());

  const firstFeedResponse = page.waitForResponse((response) => {
    return response.url().includes('/api/opportunities/feed') && response.status() === 200;
  });

  await loginFromUi(page);
  await firstFeedResponse;

  await openAiTravelAndRun(page);

  await expect(page.getByTestId('ai-travel-summary')).toContainText('Found 3 real opportunities.');
  await expect(page.getByTestId('generated-explanation-single:gen-top')).toBeVisible();

  const firstOrder = await page
    .locator('[data-testid^="generated-candidate-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));

  expect(firstOrder).toEqual([
    'generated-candidate-single:gen-top',
    'generated-candidate-single:gen-mid',
    'generated-candidate-single:gen-low'
  ]);

  await openAiTravelAndRun(page, 'Run again with the same preferences');

  const secondOrder = await page
    .locator('[data-testid^="generated-candidate-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));

  expect(secondOrder).toEqual(firstOrder);
});

test('mobile AI Travel suggestions remain visible and do not overflow horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootLanding(page, createDefaultState(), { language: 'en' });
  await mockGeneratorFeed(page, buildGeneratorFixtureItems());

  const firstFeedResponse = page.waitForResponse((response) => {
    return response.url().includes('/api/opportunities/feed') && response.status() === 200;
  });

  await loginFromUi(page);
  await firstFeedResponse;

  await openAiTravelAndRun(page, 'Mobile deterministic check');

  await expect(page.getByTestId('generated-candidate-single:gen-top')).toBeVisible();
  await expect(page.getByTestId('generated-candidate-single:gen-mid')).toBeVisible();

  const overflow = await page.getByTestId('generated-candidate-single:gen-top').evaluate((node) => {
    return node.scrollWidth > node.clientWidth;
  });
  expect(overflow).toBe(false);
});
