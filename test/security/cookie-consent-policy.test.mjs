import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptAllConsent,
  rejectOptionalConsent,
  saveConsentPreferences,
  hasConsented,
  isConsentGiven,
  clearConsent,
  enforceConsentStoragePolicy
} from '../../src/utils/cookieConsent.js';

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

function createWindowMock() {
  const listeners = new Map();
  const localStorage = createLocalStorageMock();
  return {
    localStorage,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(String(event?.type || ''));
      if (!handlers) return true;
      for (const handler of handlers) {
        handler(event);
      }
      return true;
    }
  };
}

test('reject optional consent clears functional storage keys', () => {
  const previousWindow = globalThis.window;
  const windowMock = createWindowMock();
  globalThis.window = windowMock;

  try {
    windowMock.localStorage.setItem('flight_language', 'en');
    windowMock.localStorage.setItem('flight_saved_itineraries_v1', JSON.stringify([{ key: 'x' }]));

    const record = rejectOptionalConsent();
    assert.equal(Boolean(record), true);
    assert.equal(hasConsented(), true);
    assert.equal(isConsentGiven('functional'), false);
    assert.equal(windowMock.localStorage.getItem('flight_language'), null);
    assert.equal(windowMock.localStorage.getItem('flight_saved_itineraries_v1'), null);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('custom preferences keep only permitted categories', () => {
  const previousWindow = globalThis.window;
  const windowMock = createWindowMock();
  globalThis.window = windowMock;

  try {
    acceptAllConsent();
    windowMock.localStorage.setItem('flight_language', 'it');

    const record = saveConsentPreferences({ functional: true, analytics: false });
    assert.equal(Boolean(record), true);
    assert.equal(isConsentGiven('functional'), true);
    assert.equal(isConsentGiven('analytics'), false);
    assert.equal(windowMock.localStorage.getItem('flight_language'), 'it');

    saveConsentPreferences({ functional: false, analytics: false });
    assert.equal(windowMock.localStorage.getItem('flight_language'), null);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('clearConsent removes consent record and policy can be enforced idempotently', () => {
  const previousWindow = globalThis.window;
  const windowMock = createWindowMock();
  globalThis.window = windowMock;

  try {
    acceptAllConsent();
    clearConsent();
    assert.equal(hasConsented(), false);
    const outcome = enforceConsentStoragePolicy(null);
    assert.equal(Array.isArray(outcome.removedKeys), true);
    assert.equal(Array.isArray(outcome.failedKeys), true);
  } finally {
    globalThis.window = previousWindow;
  }
});
