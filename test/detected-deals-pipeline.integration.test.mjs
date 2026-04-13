import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoutePriceStatsService } from '../server/lib/route-price-stats-service.js';
import { createDetectedDealsEngine } from '../server/lib/detected-deals-engine.js';
import { createDiscoveryFeedService } from '../server/lib/discovery-feed-service.js';

async function createMemoryDb() {
  const sqlite = await import('node:sqlite');
  return new sqlite.DatabaseSync(':memory:');
}

test('detected deals pipeline builds feed from flight_quotes and route_price_stats', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      distance_km INTEGER NULL
    );
    CREATE TABLE airports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iata_code TEXT NOT NULL,
      city_name TEXT NOT NULL
    );
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      origin_airport_id INTEGER NULL,
      destination_airport_id INTEGER NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_price REAL NOT NULL,
      provider TEXT NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      is_bookable INTEGER NOT NULL DEFAULT 1,
      observed_at TEXT NOT NULL
    );
    CREATE TABLE user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NULL,
      event_type TEXT NOT NULL,
      event_ts TEXT NOT NULL
    );
  `);

  db.prepare(`INSERT INTO airports (id, iata_code, city_name) VALUES (?, ?, ?)`).run(1, 'FCO', 'Rome');
  db.prepare(`INSERT INTO airports (id, iata_code, city_name) VALUES (?, ?, ?)`).run(2, 'LIS', 'Lisbon');
  db.prepare(`INSERT INTO routes (id, origin_iata, destination_iata, distance_km) VALUES (?, ?, ?, ?)`).run(1, 'FCO', 'LIS', 1860);

  const now = Date.now();
  const isoHoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();
  const departureDate = new Date(now + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const returnDate = new Date(now + 52 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const insertQuote = db.prepare(
    `INSERT INTO flight_quotes
      (route_id, origin_airport_id, destination_airport_id, departure_date, return_date, trip_type, cabin_class, currency, total_price, provider, stops, duration_minutes, is_bookable, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertQuote.run(1, 1, 2, departureDate, returnDate, 'round_trip', 'economy', 'EUR', 220, 'mock', 1, 520, 1, isoHoursAgo(12));
  insertQuote.run(1, 1, 2, departureDate, returnDate, 'round_trip', 'economy', 'EUR', 120, 'mock', 1, 420, 1, isoHoursAgo(1));

  const insertEvent = db.prepare(`INSERT INTO user_events (route_id, event_type, event_ts) VALUES (?, ?, ?)`);
  insertEvent.run(1, 'deal_view', isoHoursAgo(2));
  insertEvent.run(1, 'deal_save', isoHoursAgo(1.5));

  const statsService = createRoutePriceStatsService({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const stats = await statsService.refreshRoutePriceStats({ routeId: 1 });
  assert.equal(stats.skipped, false);
  assert.equal(stats.groupedRows, 1);

  const dealsEngine = createDetectedDealsEngine({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const detection = await dealsEngine.detectDeals({ routeId: 1 });
  assert.equal(detection.skipped, false);
  assert.equal(detection.publishedDeals >= 1, true);

  const feedService = createDiscoveryFeedService({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const feed = await feedService.buildDiscoveryFeed({ origin: 'FCO', limit: 5 });
  assert.equal(feed.skipped, false);
  assert.equal(feed.meta.source, 'detected_deals');
  assert.equal(feed.meta.ranking_model, 'deal_score_v1');
  assert.equal(feed.meta.ranking_variant, 'A');
  assert.equal(Array.isArray(feed.queries.top_offers), true);
  assert.equal(feed.queries.top_offers.length >= 1, true);
  assert.equal(feed.queries.top_offers[0].origin_iata, 'FCO');
  assert.equal(typeof feed.queries.top_offers[0].deal_score, 'number');
  assert.equal(Array.isArray(feed.categories.cheap_flights), true);
  assert.equal(feed.categories.cheap_flights.length >= 1, true);
});
