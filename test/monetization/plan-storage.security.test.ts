import assert from 'node:assert/strict';
import test from 'node:test';

import { readStoredUserPlan, USER_PLAN_STORAGE_KEY, writeStoredUserPlan } from '../../src/features/monetization/domain/plan-storage.ts';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? String(store.get(key)) : null;
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
    removeItem(key: string) {
      store.delete(String(key));
    }
  };
}

function grantFunctionalConsent(localStorage: ReturnType<typeof createLocalStorageMock>) {
  localStorage.setItem(
    'flight_cookie_consent_v1',
    JSON.stringify({
      functional: true,
      analytics: false,
      version: 1,
      ts: Date.now()
    })
  );
}

test('readStoredUserPlan fails closed on oversized or invalid persisted values', () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const localStorage = createLocalStorageMock();
  (globalThis as { window: { localStorage: ReturnType<typeof createLocalStorageMock> } }).window = { localStorage };

  try {
    grantFunctionalConsent(localStorage);
    localStorage.setItem(USER_PLAN_STORAGE_KEY, 'x'.repeat(256));
    assert.equal(readStoredUserPlan(), 'free');
    assert.equal(localStorage.getItem(USER_PLAN_STORAGE_KEY), null);

    localStorage.setItem(USER_PLAN_STORAGE_KEY, 'super_admin');
    assert.equal(readStoredUserPlan(), 'free');
    assert.equal(localStorage.getItem(USER_PLAN_STORAGE_KEY), null);
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }
});

test('writeStoredUserPlan stores only normalized safe plan values', () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const localStorage = createLocalStorageMock();
  (globalThis as { window: { localStorage: ReturnType<typeof createLocalStorageMock> } }).window = { localStorage };

  try {
    grantFunctionalConsent(localStorage);
    const stored = writeStoredUserPlan('ELITE');
    assert.equal(stored, 'elite');
    assert.equal(localStorage.getItem(USER_PLAN_STORAGE_KEY), 'elite');
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }
});
