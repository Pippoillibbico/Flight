import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationScanService } from '../server/lib/notification-scan-service.js';

function createMemoryCache({ forceSetNx = null } = {}) {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async setex(key, _ttlSec, value) {
      map.set(key, value);
      return 'OK';
    },
    async setnx(key, value, _ttlSec) {
      if (typeof forceSetNx === 'boolean') return forceSetNx;
      if (map.has(key)) return 0;
      map.set(key, value);
      return 1;
    },
    async del(key) {
      map.delete(key);
      return 1;
    }
  };
}

test('notification scan service creates and dedupes smart-duration notifications', async () => {
  const db = {
    alertSubscriptions: [
      {
        id: 'sub_1',
        userId: 'u1',
        enabled: true,
        scanMode: 'duration_auto',
        origin: 'MXP',
        region: 'all',
        destinationQuery: '',
        travellers: 1,
        cabinClass: 'economy',
        stayDays: 7,
        cheapOnly: false
      }
    ],
    notifications: [],
    users: [{ id: 'u1', email: 'u1@example.com' }]
  };

  const cache = createMemoryCache();
  const emailLogs = [];

  const service = createNotificationScanService({
    withDb: async (task) => task(db),
    searchFlights: () => ({ flights: [] }),
    sendMail: async () => ({ sent: true, messageId: 'm_1' }),
    insertEmailDeliveryLog: async (row) => {
      emailLogs.push(row);
    },
    getCacheClient: () => cache,
    logger: { info: () => {} },
    nanoid: () => 'notif_1',
    scanCacheTtlSec: 300,
    scanLockTtlSec: 120
  });

  const first = await service.scanSubscriptionsOnce();
  assert.equal(first.processedEmails, 1);
  assert.equal(db.notifications.length, 1);
  assert.equal(emailLogs.length, 1);

  const second = await service.scanSubscriptionsOnce();
  assert.equal(second.processedEmails, 0);
  assert.equal(db.notifications.length, 1);
});

test('notification scan service skips when lock already exists', async () => {
  const cache = createMemoryCache({ forceSetNx: false });
  const service = createNotificationScanService({
    withDb: async (task) => task({ alertSubscriptions: [], notifications: [], users: [] }),
    searchFlights: () => ({ flights: [] }),
    sendMail: async () => ({ sent: true }),
    insertEmailDeliveryLog: async () => {},
    getCacheClient: () => cache,
    logger: { info: () => {} },
    nanoid: () => 'x',
    scanCacheTtlSec: 300,
    scanLockTtlSec: 120
  });

  const result = await service.scanSubscriptionsOnce();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'lock_exists');
});
