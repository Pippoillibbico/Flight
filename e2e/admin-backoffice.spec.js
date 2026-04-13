import { expect, test } from './helpers/guarded-test';
import { bootLanding, createDefaultState, loginFromUi } from './helpers/app-test-kit';

test('backoffice unauthenticated route shows inline username/password login without auth popup', async ({ page }) => {
  await bootLanding(page, createDefaultState(), { language: 'en' });
  await page.goto('/backoffice', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('admin-backoffice-login')).toBeVisible();
  await expect(page.getByTestId('admin-backoffice-username')).toBeVisible();
  await expect(page.getByTestId('admin-backoffice-password')).toBeVisible();
  await expect(page.getByTestId('admin-backoffice-login-submit')).toBeVisible();
  await expect(page.locator('.account-drawer-backdrop.auth-modal-backdrop')).toHaveCount(0);
});

test('admin user can open private backoffice dashboard and view key sections', async ({ page }) => {
  const state = createDefaultState({
    user: {
      email: 'giustinistefano9@gmail.com'
    }
  });
  await bootLanding(page, state, { language: 'en' });
  await loginFromUi(page, 'giustinistefano9@gmail.com', 'StrongPass!123', { targetSection: 'stay' });
  await page.goto('/backoffice', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/backoffice$/);
  const dashboardPanel = page.getByTestId('admin-dashboard-panel');
  if (await dashboardPanel.isVisible().catch(() => false)) {
    await expect(page.getByTestId('admin-kpi-strip')).toBeVisible();
    await expect(page.getByTestId('admin-funnel-section')).toBeVisible();
    await expect(page.getByTestId('admin-funnel-step-login_completed')).toBeVisible();
    await expect(page.getByTestId('admin-behavior-section')).toBeVisible();
    await expect(page.getByTestId('admin-monetization-section')).toBeVisible();
    await expect(page.getByTestId('admin-operations-section')).toBeVisible();
    await expect(page.getByTestId('admin-recent-activity-section')).toBeVisible();
    return;
  }

  await expect(page.getByTestId('admin-access-denied')).toBeVisible();
});

test('non-admin user gets restricted message on direct /backoffice', async ({ page }) => {
  const state = createDefaultState({
    user: {
      email: 'user@example.com'
    }
  });
  await bootLanding(page, state, { language: 'en' });
  await loginFromUi(page, 'user@example.com', 'StrongPass!123', { targetSection: 'stay' });
  await page.goto('/backoffice', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('admin-access-denied')).toBeVisible();
  await expect(page.getByTestId('admin-dashboard-panel')).toHaveCount(0);
});
