import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataRefreshOperations } from '../../src/features/app-shell/hooks/operations/data-refresh-operations.js';

test('refreshSubscriptions normalizes drafts for each subscription item', async () => {
  const state = {
    subscriptions: null,
    draftUpdater: null
  };

  const operations = createDataRefreshOperations({
    api: {
      async listAlertSubscriptions() {
        return {
          items: [
            { id: 'sub_1', targetPrice: 120, stayDays: 5, travellers: 2, cabinClass: 'business', cheapOnly: true },
            { id: 'sub_2', targetPrice: null, stayDays: null, travellers: null, cabinClass: '', cheapOnly: false }
          ]
        };
      }
    },
    token: 'tok',
    isAuthenticated: true,
    resolveApiError: (error) => String(error?.message || error),
    notifiedIdsRef: { current: new Set() },
    setWatchlist: () => {},
    setWatchlistError: () => {},
    setSubscriptions(value) {
      state.subscriptions = value;
    },
    setAlertDraftById(updater) {
      state.draftUpdater = updater;
    },
    setNotifications: () => {},
    setUnreadCount: () => {},
    setNotifError: () => {},
    setSearchHistory: () => {},
    setSecurityEvents: () => {},
    setSecurityError: () => {}
  });

  await operations.refreshSubscriptions();

  assert.equal(Array.isArray(state.subscriptions), true);
  assert.equal(typeof state.draftUpdater, 'function');
  const nextDrafts = state.draftUpdater({});

  assert.deepEqual(nextDrafts.sub_1, {
    targetPrice: '120',
    stayDays: '5',
    travellers: '2',
    cabinClass: 'business',
    cheapOnly: true
  });
  assert.deepEqual(nextDrafts.sub_2, {
    targetPrice: '',
    stayDays: '7',
    travellers: '1',
    cabinClass: 'economy',
    cheapOnly: false
  });
});

test('refreshNotifications sets unread count and avoids duplicate browser notifications', async () => {
  const notificationsShown = [];
  const existingWindow = globalThis.window;
  globalThis.window = {
    Notification: class {
      static permission = 'granted';

      constructor(title, payload) {
        notificationsShown.push({ title, payload });
      }
    }
  };

  const unreadValues = [];
  const notifiedIdsRef = { current: new Set(['seen']) };
  const operations = createDataRefreshOperations({
    api: {
      async listNotifications() {
        return {
          unread: 3,
          items: [
            { id: 'seen', title: 'A', message: 'already seen', readAt: null },
            { id: 'new_1', title: 'B', message: 'fresh', readAt: null },
            { id: 'read_1', title: 'C', message: 'read', readAt: '2026-01-01T00:00:00.000Z' }
          ]
        };
      }
    },
    token: 'tok',
    isAuthenticated: true,
    resolveApiError: () => 'ERR',
    notifiedIdsRef,
    setWatchlist: () => {},
    setWatchlistError: () => {},
    setSubscriptions: () => {},
    setAlertDraftById: () => {},
    setNotifications: () => {},
    setUnreadCount(value) {
      unreadValues.push(value);
    },
    setNotifError: () => {},
    setSearchHistory: () => {},
    setSecurityEvents: () => {},
    setSecurityError: () => {}
  });

  try {
    await operations.refreshNotifications(true);
  } finally {
    globalThis.window = existingWindow;
  }

  assert.deepEqual(unreadValues, [3]);
  assert.deepEqual(notificationsShown, [{ title: 'B', payload: { body: 'fresh' } }]);
  assert.equal(notifiedIdsRef.current.has('new_1'), true);
});
