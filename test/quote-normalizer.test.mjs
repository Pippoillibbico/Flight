import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProviderQuotes } from '../server/lib/scan/quote-normalizer.js';

test('quote normalizer filters unrealistic offers and returns valid quotes', async () => {
  const out = normalizeProviderQuotes({
    offers: [
      {
        originIata: 'MXP',
        destinationIata: 'JFK',
        departureDate: '2026-08-10',
        returnDate: '2026-08-20',
        tripType: 'round_trip',
        cabinClass: 'economy',
        totalPrice: 450,
        currency: 'EUR',
        provider: 'mock',
        source: 'partner_feed',
        metadata: { totalStops: 1, totalDurationMinutes: 520 }
      },
      {
        originIata: 'MXP',
        destinationIata: 'JFK',
        departureDate: '2026-08-10',
        returnDate: '2026-08-20',
        tripType: 'round_trip',
        cabinClass: 'economy',
        totalPrice: 5,
        currency: 'EUR',
        provider: 'mock',
        source: 'partner_feed',
        metadata: { totalStops: 1 }
      }
    ],
    task: {
      id: 'task_1',
      adults: 1,
      cabinClass: 'economy'
    },
    scanRunId: 'run_1'
  });

  assert.equal(out.quotes.length, 1);
  assert.equal(out.rejectedCount, 1);
  assert.equal(out.quotes[0].originIata, 'MXP');
  assert.equal(out.quotes[0].destinationIata, 'JFK');
  assert.equal(typeof out.quotes[0].fingerprint, 'string');
  assert.equal(out.quotes[0].fingerprint.length > 30, true);
});
