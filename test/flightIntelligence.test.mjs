import test from 'node:test';
import assert from 'node:assert/strict';
import { initPriceHistoryStore, storeObservation } from '../server/lib/price-history-store.js';
import { detectDeal } from '../server/lib/deal-detector.js';
import { inferDealType, rankDeal } from '../server/lib/deal-ranking-engine.js';

function iataFromSeed(seed) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const a = alphabet[Math.floor(seed / (26 * 26)) % 26];
  const b = alphabet[Math.floor(seed / 26) % 26];
  const c = alphabet[seed % 26];
  return `${a}${b}${c}`;
}

test('price-history-store dedupes identical fingerprints', async () => {
  await initPriceHistoryStore();
  const seed = Date.now() % 17576;
  const origin = iataFromSeed(seed);
  const destination = iataFromSeed((seed + 137) % 17576);
  const payload = {
    origin,
    destination,
    date: '2027-07-10',
    price: 221.45,
    timestamp: '2026-01-01T10:00:00.000Z',
    airline: 'test_airline',
    source: 'unit_test',
    currency: 'EUR',
    returnDate: '2027-07-14',
    cabinClass: 'economy',
    tripType: 'round_trip',
    metadata: { test: true }
  };

  const first = await storeObservation(payload);
  const second = await storeObservation(payload);
  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(first.fingerprint, second.fingerprint);
});

test('deal-ranking rules classify and bound score', async () => {
  assert.equal(inferDealType({ dropPct: 50, anomaly: true, belowP10: true }), 'error_fare');
  assert.equal(inferDealType({ dropPct: 38, anomaly: false, belowP10: true }), 'flash_sale');
  assert.equal(inferDealType({ dropPct: 20, anomaly: false, belowP10: false, belowP25: true }), 'hidden_deal');
  assert.equal(inferDealType({ dropPct: 21, anomaly: false, belowP10: false, belowP25: false }), 'seasonal_drop');

  const score = rankDeal({
    priceDropPct: 42,
    rarity: 0.8,
    historicalPercentile: 0.07,
    destinationPopularity: 0.2
  });
  assert.equal(Number.isInteger(score), true);
  assert.equal(score >= 0 && score <= 100, true);
});

test('deal-detector flags strong under-baseline prices', async () => {
  await initPriceHistoryStore();
  const seed = (Date.now() + 333) % 17576;
  const origin = iataFromSeed(seed);
  const destination = iataFromSeed((seed + 211) % 17576);
  const departure = '2027-08-15';

  const history = [310, 320, 330, 340, 350, 360, 305, 325, 345, 365, 315, 335];
  for (let i = 0; i < history.length; i += 1) {
    await storeObservation({
      origin,
      destination,
      date: departure,
      price: history[i],
      timestamp: `2026-02-${String(1 + i).padStart(2, '0')}T09:00:00.000Z`,
      airline: 'test_airline',
      source: 'unit_test',
      currency: 'EUR',
      returnDate: '2027-08-22',
      cabinClass: 'economy',
      tripType: 'round_trip',
      metadata: { batch: 'detector' }
    });
  }

  const result = await detectDeal({
    origin,
    destination,
    date: departure,
    price: 169
  });

  assert.equal(result.rules.below_baseline_65, true);
  assert.equal(result.deal_score >= 60, true);
  assert.equal(['error_fare', 'flash_sale', 'hidden_deal', 'seasonal_drop', 'normal'].includes(result.deal_type), true);
});
