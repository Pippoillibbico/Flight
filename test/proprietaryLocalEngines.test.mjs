import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import { withDb } from '../server/lib/db.js';
import { computeBaseline } from '../server/lib/baseline-price-engine.js';
import { findCheapestDestinations } from '../server/lib/destination-discovery-engine.js';
import { ingestPriceObservation, initDealEngineStore, recomputeRouteBaselines } from '../server/lib/deal-engine-store.js';
import { runPriceIngestionWorkerOnce } from '../server/lib/price-ingestion-worker.js';
import { evaluateObservationForAlerts } from '../server/lib/alert-intelligence.js';
import { initPriceHistoryStore, storeObservation } from '../server/lib/price-history-store.js';

function iataFromSeed(seed) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const a = alphabet[Math.floor(seed / (26 * 26)) % 26];
  const b = alphabet[Math.floor(seed / 26) % 26];
  const c = alphabet[seed % 26];
  return `${a}${b}${c}`;
}

async function seedRouteHistory({ origin, destination, date, base = 300, points = 18 }) {
  for (let i = 0; i < points; i += 1) {
    await storeObservation({
      origin,
      destination,
      date,
      price: base + (i % 7) * 10 + Math.floor(i / 6) * 4,
      timestamp: `2026-03-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
      airline: 'unit_test_airline',
      source: 'unit_test',
      currency: 'EUR',
      returnDate: '2027-09-22',
      cabinClass: 'economy',
      tripType: 'round_trip',
      metadata: { test: true }
    });
  }
}

async function seedRouteBaselines({ origin, destination, base = 300, points = 36 }) {
  await initDealEngineStore();
  for (let i = 0; i < points; i += 1) {
    await ingestPriceObservation({
      origin_iata: origin,
      destination_iata: destination,
      departure_date: `2027-08-${String((i % 27) + 1).padStart(2, '0')}`,
      return_date: `2027-08-${String((i % 27) + 3).padStart(2, '0')}`,
      currency: 'EUR',
      total_price: base + (i % 8) * 7 + Math.floor(i / 6) * 2,
      provider: 'local_dataset',
      cabin_class: 'economy',
      trip_type: 'round_trip',
      observed_at: `2026-05-${String((i % 27) + 1).padStart(2, '0')}T09:00:00.000Z`,
      source: 'manual'
    });
  }
}

test('baseline-price-engine computes deterministic baseline from local history', async () => {
  await initPriceHistoryStore();
  const seed = Date.now() % 17576;
  const origin = iataFromSeed(seed);
  const destination = iataFromSeed((seed + 71) % 17576);
  const date = '2027-09-15';
  await seedRouteHistory({ origin, destination, date });

  const baseline = await computeBaseline({ origin, destination, date });
  assert.equal(Number.isFinite(baseline.baseline), true);
  assert.equal(baseline.baseline > 0, true);
  assert.equal(Number.isFinite(baseline.observationCount), true);
});

test('price-ingestion-worker imports local CSV without external providers', async () => {
  await initPriceHistoryStore();
  const seed = (Date.now() + 777) % 17576;
  const origin = iataFromSeed(seed);
  const destination = iataFromSeed((seed + 91) % 17576);
  const tmpDir = await mkdtemp(join(tmpdir(), 'flight-price-ingest-'));
  const csvPath = join(tmpDir, 'local-prices.csv');
  const csv = [
    'origin_iata,destination_iata,departure_date,return_date,currency,total_price,provider,cabin_class,trip_type,observed_at,source',
    `${origin},${destination},2027-10-10,2027-10-17,EUR,222.42,local_dataset,economy,round_trip,2026-04-10T09:00:00.000Z,csv_unit_test`
  ].join('\n');
  await writeFile(csvPath, csv, 'utf8');

  const result = await runPriceIngestionWorkerOnce({ csvPath, maxJobs: 1 });
  assert.equal(result.processed >= 1, true);
  assert.equal(result.inserted >= 1, true);

  await rm(tmpDir, { recursive: true, force: true });
});

test('alert-intelligence triggers once for strong local deal', async () => {
  await initPriceHistoryStore();
  const seed = (Date.now() + 1337) % 17576;
  const origin = iataFromSeed(seed);
  const destination = iataFromSeed((seed + 103) % 17576);
  const date = '2027-11-15';
  await seedRouteHistory({ origin, destination, date, base: 390, points: 24 });

  const userId = `user_${nanoid(8)}`;
  const subId = `sub_${nanoid(8)}`;
  await withDb((db) => {
    db.alertSubscriptions = db.alertSubscriptions || [];
    db.alertSubscriptions.push({
      id: subId,
      userId,
      enabled: true,
      origin,
      destinationIata: destination,
      targetPrice: 250
    });
    return db;
  });

  const result = await evaluateObservationForAlerts({
    origin,
    destination,
    date,
    price: 149,
    fingerprint: `${origin}${destination}${date.replaceAll('-', '')}${nanoid(24)}`,
    observedAt: '2026-05-01T12:00:00.000Z'
  });
  assert.equal(result.triggered >= 1, true);
});

test('destination-discovery-engine returns local suggestions from history', async () => {
  await initPriceHistoryStore();
  const seed = (Date.now() + 1777) % 17576;
  const origin = iataFromSeed(seed);
  const destinationA = iataFromSeed((seed + 17) % 17576);
  const destinationB = iataFromSeed((seed + 29) % 17576);
  const date = '2027-08-15';

  await seedRouteHistory({ origin, destination: destinationA, date, base: 240, points: 36 });
  await seedRouteHistory({ origin, destination: destinationB, date, base: 320, points: 36 });
  await seedRouteBaselines({ origin, destination: destinationA, base: 240, points: 44 });
  await seedRouteBaselines({ origin, destination: destinationB, base: 320, points: 44 });
  await recomputeRouteBaselines();

  const items = await findCheapestDestinations(origin, '2027-08', 5);
  assert.equal(Array.isArray(items), true);
  assert.equal(items.length >= 1, true);
  assert.equal(typeof items[0].destination, 'string');
  assert.equal(typeof items[0].deal_score, 'number');
  assert.equal(typeof items[0].deal_type, 'string');
  assert.equal(typeof items[0].score, 'number');
  assert.equal(typeof items[0].badge, 'string');
  assert.equal(Array.isArray(items[0].reasons), true);
  assert.equal(typeof items[0].confidence, 'object');
});
