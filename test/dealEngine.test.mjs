import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestPriceObservation, initDealEngineStore, recomputeRouteBaselines, scoreDeal } from '../server/lib/deal-engine-store.js';

function isoNowOffset(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

test('ingestion dedupe blocks duplicate fingerprint', async () => {
  await initDealEngineStore();
  const marker = Date.now();
  const payload = {
    origin_iata: 'ZZZ',
    destination_iata: 'YYY',
    departure_date: '2027-02-10',
    return_date: '2027-02-15',
    currency: 'EUR',
    total_price: 199.99,
    provider: `partner_feed_test_${marker}`,
    cabin_class: 'economy',
    trip_type: 'round_trip',
    observed_at: isoNowOffset(1),
    source: 'csv_import_test'
  };

  const first = await ingestPriceObservation(payload);
  const second = await ingestPriceObservation(payload);
  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(first.fingerprint, second.fingerprint);
});

test('dealScore rules map to scream and great correctly', async () => {
  await initDealEngineStore();
  const stamp = Date.now();
  const origin = 'QWE';
  const destination = 'RTY';
  const departure = '2027-03-10';
  const prices = [100, 120, 140, 160, 180];

  for (let i = 0; i < prices.length; i += 1) {
    await ingestPriceObservation({
      origin_iata: origin,
      destination_iata: destination,
      departure_date: departure,
      return_date: '2027-03-15',
      currency: 'EUR',
      total_price: prices[i],
      provider: `partner_feed_test_${stamp}_${i}`,
      cabin_class: 'economy',
      trip_type: 'round_trip',
      observed_at: isoNowOffset(5 + i),
      source: 'csv_import_test'
    });
  }

  await recomputeRouteBaselines();
  const scream = await scoreDeal({ origin, destination, departureDate: departure, price: 100 });
  const great = await scoreDeal({ origin, destination, departureDate: departure, price: 115 });

  assert.equal(scream.dealLevel, 'scream');
  assert.equal(great.dealLevel, 'great');
  assert.equal(Number.isFinite(scream.dealScore), true);
  assert.equal(great.confidence.observationCount >= 5, true);
});
