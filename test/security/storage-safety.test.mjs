import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearLocalTravelData,
  clearRememberedEmail,
  exportLocalTravelData,
  readRememberedEmail,
  readSavedItineraries,
  readTrackedRouteSlugs,
  REMEMBERED_EMAIL_STORAGE_KEY,
  SAVED_ITINERARIES_STORAGE_KEY,
  TRACKED_ROUTES_STORAGE_KEY,
  UPGRADE_INTEREST_STORAGE_KEY,
  USER_PLAN_STORAGE_KEY,
  writeRememberedEmail
} from '../../src/features/personal-hub/storage.js';

function grantFullConsent(windowMock) {
  windowMock.localStorage.setItem(
    'flight_cookie_consent_v1',
    JSON.stringify({
      functional: true,
      analytics: true,
      version: 1,
      ts: Date.now()
    })
  );
}

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? String(store.get(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    }
  };
}

test('personal hub readers fail closed on oversized localStorage payloads', () => {
  const previousWindow = globalThis.window;
  const windowMock = {
    localStorage: createLocalStorageMock(),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {}
  };

  globalThis.window = windowMock;
  try {
    grantFullConsent(windowMock);
    const hugeValue = 'x'.repeat(140_000);
    windowMock.localStorage.setItem(TRACKED_ROUTES_STORAGE_KEY, hugeValue);
    windowMock.localStorage.setItem(SAVED_ITINERARIES_STORAGE_KEY, hugeValue);

    assert.deepEqual(readTrackedRouteSlugs(), []);
    assert.deepEqual(readSavedItineraries(), []);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('exportLocalTravelData returns minimized snapshot and omits stale upgrade records', () => {
  const previousWindow = globalThis.window;
  const windowMock = {
    localStorage: createLocalStorageMock(),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {}
  };

  globalThis.window = windowMock;
  try {
    grantFullConsent(windowMock);
    windowMock.localStorage.setItem(TRACKED_ROUTES_STORAGE_KEY, JSON.stringify(['japan']));
    windowMock.localStorage.setItem(
      SAVED_ITINERARIES_STORAGE_KEY,
      JSON.stringify([{ key: 'it-1', itineraryId: 'it-1', routeLabel: 'MXP -> LIS', price: 120, currency: 'EUR', label: 'Recently viewed' }])
    );
    windowMock.localStorage.setItem(USER_PLAN_STORAGE_KEY, 'elite');
    windowMock.localStorage.setItem(
      UPGRADE_INTEREST_STORAGE_KEY,
      JSON.stringify([
        {
          planType: 'pro',
          source: 'premium_page',
          submittedAt: new Date().toISOString(),
          userId: 'usr_1',
          userEmail: 'mail_legacy'
        },
        {
          planType: 'elite',
          source: 'legacy_old',
          submittedAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
          userId: 'usr_old'
        }
      ])
    );
    writeRememberedEmail('snapshot@example.com');

    const snapshot = exportLocalTravelData({ includeAccountHints: true });
    assert.equal(Array.isArray(snapshot?.data?.trackedRoutes), true);
    assert.equal(snapshot?.data?.trackedRoutes?.[0], 'japan');
    assert.equal(snapshot?.data?.userPlan, 'elite');
    assert.equal(Array.isArray(snapshot?.data?.upgradeInterests), true);
    assert.equal(snapshot?.data?.upgradeInterests?.length, 1);
    assert.equal(snapshot?.data?.upgradeInterests?.[0]?.source, 'premium_page');
    assert.equal(snapshot?.data?.upgradeInterests?.[0]?.userEmail, undefined);
    assert.equal(snapshot?.data?.accountHints?.rememberedEmail, 'snapshot@example.com');
  } finally {
    globalThis.window = previousWindow;
  }
});

test('remembered email storage is validated and expires stale data', () => {
  const previousWindow = globalThis.window;
  const windowMock = {
    localStorage: createLocalStorageMock(),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {}
  };

  globalThis.window = windowMock;
  try {
    grantFullConsent(windowMock);
    const saved = writeRememberedEmail('privacy@example.com');
    assert.equal(saved, 'privacy@example.com');
    assert.equal(readRememberedEmail(), 'privacy@example.com');

    windowMock.localStorage.setItem(
      REMEMBERED_EMAIL_STORAGE_KEY,
      JSON.stringify({
        email: 'old@example.com',
        savedAt: '2020-01-01T00:00:00.000Z'
      })
    );
    assert.equal(readRememberedEmail(), '');

    clearRememberedEmail();
    assert.equal(windowMock.localStorage.getItem(REMEMBERED_EMAIL_STORAGE_KEY), null);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('clearLocalTravelData removes privacy-relevant local keys', () => {
  const previousWindow = globalThis.window;
  const windowMock = {
    localStorage: createLocalStorageMock(),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {}
  };

  globalThis.window = windowMock;
  try {
    grantFullConsent(windowMock);
    windowMock.localStorage.setItem(TRACKED_ROUTES_STORAGE_KEY, JSON.stringify(['japan']));
    windowMock.localStorage.setItem(SAVED_ITINERARIES_STORAGE_KEY, JSON.stringify([{ key: 'x' }]));
    windowMock.localStorage.setItem(USER_PLAN_STORAGE_KEY, 'elite');
    windowMock.localStorage.setItem(UPGRADE_INTEREST_STORAGE_KEY, JSON.stringify([{ planType: 'pro' }]));
    writeRememberedEmail('clearme@example.com');

    const result = clearLocalTravelData({ includeAccountHints: true });
    assert.equal(result.failedKeys.length, 0);
    assert.equal(windowMock.localStorage.getItem(TRACKED_ROUTES_STORAGE_KEY), null);
    assert.equal(windowMock.localStorage.getItem(SAVED_ITINERARIES_STORAGE_KEY), null);
    assert.equal(windowMock.localStorage.getItem(USER_PLAN_STORAGE_KEY), null);
    assert.equal(windowMock.localStorage.getItem(UPGRADE_INTEREST_STORAGE_KEY), null);
    assert.equal(windowMock.localStorage.getItem(REMEMBERED_EMAIL_STORAGE_KEY), null);
  } finally {
    globalThis.window = previousWindow;
  }
});
