import assert from 'node:assert/strict';
import test from 'node:test';
import { createPriceAlertsNotifier } from '../server/lib/price-alerts-notifier.js';

test('price alerts notifier dispatches in-app and email notifications with dedupe', async () => {
  const db = {
    users: [{ id: 'u1', email: 'u1@example.com' }],
    notifications: [],
    pushDeadLetters: []
  };

  let cursor = null;
  const deliveries = new Set();
  const checked = [];
  const triggered = [];
  const emailLogs = [];
  const store = {
    async getWorkerCursor() {
      return cursor;
    },
    async setWorkerCursor(next) {
      cursor = next;
    },
    async listMatchingDeals() {
      return {
        skipped: false,
        reason: null,
        matches: [
          {
            alert_id: 'pa_1',
            user_id: 'u1',
            channels: { push: true, email: true, in_app: true },
            max_price: 350,
            alert_currency: 'EUR',
            deal_key: 'deal_1',
            detected_deal_id: 1,
            route_id: 11,
            flight_quote_id: 22,
            deal_price: 299,
            final_score: 81,
            savings_pct: 19,
            origin_iata: 'FCO',
            destination_iata: 'JFK',
            departure_date: '2026-05-10',
            return_date: '2026-05-20',
            trip_type: 'round_trip',
            stops: 0,
            provider: 'provider',
            currency: 'EUR',
            source_observed_at: '2026-03-12T10:00:00.000Z',
            published_at: '2026-03-12T10:00:00.000Z'
          }
        ]
      };
    },
    async claimDelivery({ alertId, dealKey, channel }) {
      const key = `${alertId}:${dealKey}:${channel}`;
      if (deliveries.has(key)) return false;
      deliveries.add(key);
      return true;
    },
    async markAlertsChecked(ids) {
      checked.push(...ids);
    },
    async markAlertsTriggered(ids) {
      triggered.push(...ids);
    }
  };

  const notifier = createPriceAlertsNotifier({
    store,
    withDb: async (task) => task(db),
    sendMail: async () => ({ sent: true, messageId: 'm_1' }),
    insertEmailDeliveryLog: async (row) => emailLogs.push(row),
    logger: { info: () => {}, warn: () => {} }
  });

  const firstRun = await notifier.runPriceAlertsScanOnce({ limit: 50 });
  assert.equal(firstRun.processed, 1);
  assert.equal(firstRun.sentInApp, 1);
  assert.equal(firstRun.sentEmail, 1);
  assert.equal(firstRun.sentPush, 0);
  assert.equal(db.notifications.length, 1);
  assert.equal(emailLogs.length, 1);
  assert.equal(checked.includes('pa_1'), true);
  assert.equal(triggered.includes('pa_1'), true);

  const secondRun = await notifier.runPriceAlertsScanOnce({ limit: 50 });
  assert.equal(secondRun.deduped, 3);
  assert.equal(db.notifications.length, 1);
  assert.equal(emailLogs.length, 1);
});
