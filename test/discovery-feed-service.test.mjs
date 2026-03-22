import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiscoveryFeedService, getDiscoveryFeedRuntimeMetrics } from '../server/lib/discovery-feed-service.js';

async function createMemoryDb() {
  const sqlite = await import('node:sqlite');
  return new sqlite.DatabaseSync(':memory:');
}

function fmtDate(date) {
  return date.toISOString().slice(0, 10);
}

function nextWeekday(startDate, weekday) {
  const d = new Date(startDate.getTime());
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

test('discovery feed service builds base queries and categories from detected_deals only', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      distance_km INTEGER NULL
    );
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      provider TEXT NULL,
      origin_airport_id INTEGER NULL,
      destination_airport_id INTEGER NULL
    );
    CREATE TABLE airports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iata_code TEXT NOT NULL,
      city_name TEXT NOT NULL
    );
    CREATE TABLE detected_deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_key TEXT NOT NULL UNIQUE,
      flight_quote_id INTEGER NOT NULL,
      route_id INTEGER NOT NULL,
      deal_type TEXT NOT NULL,
      raw_score REAL NOT NULL,
      final_score REAL NOT NULL,
      deal_score REAL NULL,
      opportunity_level TEXT NOT NULL,
      price REAL NOT NULL,
      baseline_price REAL NULL,
      savings_amount REAL NULL,
      savings_pct REAL NULL,
      status TEXT NOT NULL,
      score_breakdown TEXT NOT NULL,
      published_at TEXT NULL,
      expires_at TEXT NULL,
      source_observed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const insertRoute = db.prepare(`INSERT INTO routes (id, origin_iata, destination_iata, distance_km) VALUES (?, ?, ?, ?)`);
  insertRoute.run(1, 'FCO', 'JFK', 6900);
  insertRoute.run(2, 'FCO', 'BCN', 860);
  insertRoute.run(3, 'FCO', 'LIS', 1860);
  insertRoute.run(4, 'FCO', 'DXB', 4340);

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const friday = nextWeekday(todayUtc, 5);
  if (friday < todayUtc) friday.setUTCDate(friday.getUTCDate() + 7);
  const monday = new Date(friday.getTime());
  monday.setUTCDate(monday.getUTCDate() + 3);

  const nearFuture = new Date(todayUtc.getTime() + 2 * 24 * 60 * 60 * 1000);
  const midFuture = new Date(todayUtc.getTime() + 20 * 24 * 60 * 60 * 1000);
  const farFuture = new Date(todayUtc.getTime() + 40 * 24 * 60 * 60 * 1000);
  const farReturn = new Date(farFuture.getTime() + 7 * 24 * 60 * 60 * 1000);

  const insertQuote = db.prepare(
    `INSERT INTO flight_quotes
      (id, route_id, departure_date, return_date, trip_type, cabin_class, currency, stops, duration_minutes, provider, origin_airport_id, destination_airport_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertQuote.run(11, 1, fmtDate(friday), fmtDate(monday), 'round_trip', 'economy', 'EUR', 1, 620, 'mock', null, null);
  insertQuote.run(12, 2, fmtDate(midFuture), fmtDate(new Date(midFuture.getTime() + 3 * 24 * 60 * 60 * 1000)), 'round_trip', 'economy', 'EUR', 0, 115, 'mock', null, null);
  insertQuote.run(13, 3, fmtDate(nearFuture), null, 'one_way', 'economy', 'EUR', 1, 170, 'mock', null, null);
  insertQuote.run(14, 4, fmtDate(farFuture), fmtDate(farReturn), 'round_trip', 'economy', 'EUR', 1, 520, 'mock', null, null);

  const now = Date.now();
  const isoHoursAgo = (h) => new Date(now - h * 60 * 60 * 1000).toISOString();

  const insertDeal = db.prepare(
    `INSERT INTO detected_deals
      (deal_key, flight_quote_id, route_id, deal_type, raw_score, final_score, deal_score, opportunity_level, price, baseline_price, savings_amount, savings_pct, status, score_breakdown, published_at, expires_at, source_observed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertDeal.run(
    'd1',
    11,
    1,
    'rare_opportunity',
    90,
    92,
    86.5,
    'Rare opportunity',
    220,
    450,
    230,
    51.11,
    'published',
    JSON.stringify({ signals: { route_popularity_30d: 80, user_signals_30d: 15 } }),
    isoHoursAgo(1),
    null,
    isoHoursAgo(1),
    isoHoursAgo(1)
  );
  insertDeal.run(
    'd2',
    12,
    2,
    'great_deal',
    75,
    80,
    88.2,
    'Great deal',
    70,
    140,
    70,
    50,
    'published',
    JSON.stringify({ signals: { route_popularity_30d: 120, user_signals_30d: 20 } }),
    isoHoursAgo(2),
    null,
    isoHoursAgo(2),
    isoHoursAgo(2)
  );
  insertDeal.run(
    'd3',
    13,
    3,
    'great_deal',
    70,
    74,
    72.8,
    'Great deal',
    45,
    90,
    45,
    50,
    'published',
    JSON.stringify({ signals: { route_popularity_30d: 45, user_signals_30d: 5 } }),
    isoHoursAgo(0.5),
    null,
    isoHoursAgo(0.5),
    isoHoursAgo(0.5)
  );
  insertDeal.run(
    'd4',
    14,
    4,
    'exceptional_price',
    84,
    85,
    82.4,
    'Exceptional price',
    300,
    600,
    300,
    50,
    'published',
    JSON.stringify({ signals: { route_popularity_30d: 260, user_signals_30d: 40 } }),
    isoHoursAgo(30),
    null,
    isoHoursAgo(30),
    isoHoursAgo(30)
  );

  const service = createDiscoveryFeedService({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const version = await service.getFeedVersion({ origin: 'FCO' });
  assert.match(String(version), /\|4$/);

  const payload = await service.buildDiscoveryFeed({ origin: 'FCO', limit: 3 });
  assert.equal(payload.skipped, false);
  assert.equal(payload.meta.total_candidates, 4);
  assert.equal(payload.meta.ranking_model, 'deal_score_v1');
  assert.equal(payload.meta.ranking_variant, 'A');
  assert.equal(typeof payload.meta.ranking_weights, 'object');

  assert.equal(payload.queries.top_offers[0].deal_key, 'd2');
  assert.equal(typeof payload.queries.top_offers[0].deal_score, 'number');
  assert.equal(payload.queries.top_offers[0].deal_score >= payload.queries.top_offers[1].deal_score, true);
  assert.equal(payload.queries.recent_offers[0].deal_key, 'd3');
  assert.equal(payload.queries.popular_offers.some((item) => item.deal_key === 'd4'), true);

  assert.equal(payload.categories.cheap_flights[0].deal_key, 'd3');
  assert.equal(payload.categories.weekend_flights.some((item) => item.deal_key === 'd1'), true);
  assert.equal(payload.categories.last_minute_flights.some((item) => item.deal_key === 'd3'), true);
  assert.equal(payload.categories.long_haul_discounted.some((item) => item.deal_key === 'd1'), true);
  assert.equal(payload.categories.long_haul_discounted.some((item) => item.deal_key === 'd4'), true);

  const payloadVariantB = await service.buildDiscoveryFeed({ origin: 'FCO', limit: 3, rankingVariant: 'B' });
  assert.equal(payloadVariantB.skipped, false);
  assert.equal(payloadVariantB.meta.ranking_variant, 'B');
  assert.equal(typeof payloadVariantB.meta.ranking_weights, 'object');
  assert.equal(typeof payloadVariantB.queries.top_offers[0].deal_score, 'number');
});

test('discovery feed service filters expired/stale noise and dedupes near-duplicates', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      distance_km INTEGER NULL
    );
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      provider TEXT NULL,
      origin_airport_id INTEGER NULL,
      destination_airport_id INTEGER NULL
    );
    CREATE TABLE airports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iata_code TEXT NOT NULL,
      city_name TEXT NOT NULL
    );
    CREATE TABLE detected_deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_key TEXT NOT NULL UNIQUE,
      flight_quote_id INTEGER NOT NULL,
      route_id INTEGER NOT NULL,
      deal_type TEXT NOT NULL,
      raw_score REAL NOT NULL,
      final_score REAL NOT NULL,
      deal_score REAL NULL,
      opportunity_level TEXT NOT NULL,
      price REAL NOT NULL,
      baseline_price REAL NULL,
      savings_amount REAL NULL,
      savings_pct REAL NULL,
      status TEXT NOT NULL,
      score_breakdown TEXT NOT NULL,
      published_at TEXT NULL,
      expires_at TEXT NULL,
      source_observed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const insertRoute = db.prepare(`INSERT INTO routes (id, origin_iata, destination_iata, distance_km) VALUES (?, ?, ?, ?)`);
  insertRoute.run(1, 'FCO', 'JFK', 6900);
  insertRoute.run(2, 'FCO', 'LAX', 10100);
  insertRoute.run(3, 'FCO', 'NRT', 9850);

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const departA = new Date(now + 21 * dayMs);
  const returnA = new Date(now + 28 * dayMs);
  const departB = new Date(now + 31 * dayMs);
  const returnB = new Date(now + 38 * dayMs);
  const departC = new Date(now + 45 * dayMs);
  const returnC = new Date(now + 52 * dayMs);

  const insertQuote = db.prepare(
    `INSERT INTO flight_quotes
      (id, route_id, departure_date, return_date, trip_type, cabin_class, currency, stops, duration_minutes, provider, origin_airport_id, destination_airport_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertQuote.run(21, 1, fmtDate(departA), fmtDate(returnA), 'round_trip', 'economy', 'EUR', 1, 640, 'mock', null, null);
  insertQuote.run(22, 1, fmtDate(departA), fmtDate(returnA), 'round_trip', 'economy', 'EUR', 1, 655, 'mock', null, null);
  insertQuote.run(23, 2, fmtDate(departB), fmtDate(returnB), 'round_trip', 'economy', 'EUR', 1, 710, 'mock', null, null);
  insertQuote.run(24, 3, fmtDate(departC), fmtDate(returnC), 'round_trip', 'economy', 'EUR', 1, 780, 'mock', null, null);

  const isoHoursAgo = (h) => new Date(now - h * 60 * 60 * 1000).toISOString();
  const isoHoursAhead = (h) => new Date(now + h * 60 * 60 * 1000).toISOString();

  const insertDeal = db.prepare(
    `INSERT INTO detected_deals
      (deal_key, flight_quote_id, route_id, deal_type, raw_score, final_score, deal_score, opportunity_level, price, baseline_price, savings_amount, savings_pct, status, score_breakdown, published_at, expires_at, source_observed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertDeal.run(
    'nd_1',
    21,
    1,
    'great_deal',
    80,
    82,
    84,
    'Great deal',
    300,
    500,
    200,
    40,
    'published',
    JSON.stringify({ signals: { route_popularity_30d: 120, user_signals_30d: 20 } }),
    isoHoursAgo(1),
    isoHoursAhead(48),
    isoHoursAgo(1),
    isoHoursAgo(1)
  );
  insertDeal.run(
    'nd_2',
    22,
    1,
    'great_deal',
    79,
    81,
    82,
    'Great deal',
    307,
    500,
    193,
    38.6,
    'published',
    JSON.stringify({ signals: { route_popularity_30d: 110, user_signals_30d: 18 } }),
    isoHoursAgo(2),
    isoHoursAhead(48),
    isoHoursAgo(2),
    isoHoursAgo(2)
  );
  insertDeal.run(
    'expired_1',
    23,
    2,
    'great_deal',
    82,
    84,
    83,
    'Great deal',
    280,
    520,
    240,
    46.1,
    'published',
    JSON.stringify({ signals: { route_popularity_30d: 90, user_signals_30d: 12 } }),
    isoHoursAgo(4),
    isoHoursAgo(1),
    isoHoursAgo(4),
    isoHoursAgo(4)
  );
  insertDeal.run(
    'stale_1',
    24,
    3,
    'great_deal',
    85,
    86,
    86,
    'Great deal',
    350,
    700,
    350,
    50,
    'published',
    JSON.stringify({ signals: { route_popularity_30d: 220, user_signals_30d: 40 } }),
    isoHoursAgo(240),
    isoHoursAhead(72),
    isoHoursAgo(240),
    isoHoursAgo(240)
  );

  const service = createDiscoveryFeedService({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const payload = await service.buildDiscoveryFeed({ origin: 'FCO', limit: 10 });
  assert.equal(payload.skipped, false);
  assert.equal(payload.meta.source_rows, 2);
  assert.equal(payload.meta.valid_candidates, 2);
  assert.equal(payload.meta.near_duplicate_filtered, 1);
  assert.equal(payload.meta.total_candidates, 1);
  assert.equal(payload.queries.top_offers.length, 1);
  assert.equal(payload.queries.top_offers[0].deal_key, 'nd_1');
});

test('discovery feed service filters non-bookable rows and applies destination diversity cap', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      distance_km INTEGER NULL
    );
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      provider TEXT NULL,
      is_bookable INTEGER NULL,
      origin_airport_id INTEGER NULL,
      destination_airport_id INTEGER NULL
    );
    CREATE TABLE airports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iata_code TEXT NOT NULL,
      city_name TEXT NOT NULL
    );
    CREATE TABLE detected_deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_key TEXT NOT NULL UNIQUE,
      flight_quote_id INTEGER NOT NULL,
      route_id INTEGER NOT NULL,
      deal_type TEXT NOT NULL,
      raw_score REAL NOT NULL,
      final_score REAL NOT NULL,
      deal_score REAL NULL,
      opportunity_level TEXT NOT NULL,
      price REAL NOT NULL,
      baseline_price REAL NULL,
      savings_amount REAL NULL,
      savings_pct REAL NULL,
      status TEXT NOT NULL,
      score_breakdown TEXT NOT NULL,
      published_at TEXT NULL,
      expires_at TEXT NULL,
      source_observed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const insertRoute = db.prepare(`INSERT INTO routes (id, origin_iata, destination_iata, distance_km) VALUES (?, ?, ?, ?)`);
  insertRoute.run(1, 'FCO', 'JFK', 6900);

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const quoteRows = [
    { id: 31, depart: 20, ret: 27, bookable: 1, price: 310, score: 90 },
    { id: 32, depart: 24, ret: 31, bookable: 1, price: 330, score: 88 },
    { id: 33, depart: 28, ret: 35, bookable: 1, price: 350, score: 86 },
    { id: 34, depart: 32, ret: 39, bookable: 1, price: 370, score: 84 },
    { id: 35, depart: 36, ret: 43, bookable: 0, price: 210, score: 95 }
  ];

  const insertQuote = db.prepare(
    `INSERT INTO flight_quotes
      (id, route_id, departure_date, return_date, trip_type, cabin_class, currency, stops, duration_minutes, provider, is_bookable, origin_airport_id, destination_airport_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of quoteRows) {
    insertQuote.run(
      row.id,
      1,
      fmtDate(new Date(now + row.depart * dayMs)),
      fmtDate(new Date(now + row.ret * dayMs)),
      'round_trip',
      'economy',
      'EUR',
      1,
      640,
      'mock',
      row.bookable,
      null,
      null
    );
  }

  const isoHoursAgo = (h) => new Date(now - h * 60 * 60 * 1000).toISOString();
  const isoHoursAhead = (h) => new Date(now + h * 60 * 60 * 1000).toISOString();

  const insertDeal = db.prepare(
    `INSERT INTO detected_deals
      (deal_key, flight_quote_id, route_id, deal_type, raw_score, final_score, deal_score, opportunity_level, price, baseline_price, savings_amount, savings_pct, status, score_breakdown, published_at, expires_at, source_observed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of quoteRows) {
    insertDeal.run(
      `div_${row.id}`,
      row.id,
      1,
      'great_deal',
      row.score - 1,
      row.score,
      row.score,
      'Great deal',
      row.price,
      600,
      600 - row.price,
      ((600 - row.price) / 600) * 100,
      'published',
      JSON.stringify({ signals: { route_popularity_30d: 130, user_signals_30d: 24 } }),
      isoHoursAgo(1),
      isoHoursAhead(48),
      isoHoursAgo(1),
      isoHoursAgo(1)
    );
  }

  const service = createDiscoveryFeedService({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const payload = await service.buildDiscoveryFeed({ origin: 'FCO', limit: 10 });
  assert.equal(payload.skipped, false);
  assert.equal(payload.meta.source_rows, 4);
  assert.equal(payload.meta.valid_candidates, 4);
  assert.equal(payload.meta.destination_diversity_filtered, 1);
  assert.equal(payload.meta.max_per_destination, 3);
  assert.equal(payload.meta.total_candidates, 3);
  assert.equal(payload.queries.top_offers.length, 3);
  assert.equal(payload.queries.top_offers.every((item) => item.is_bookable !== false), true);
});

test('discovery feed runtime metrics increase after build invocation', async () => {
  const before = getDiscoveryFeedRuntimeMetrics();
  const db = await createMemoryDb();
  const service = createDiscoveryFeedService({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const payload = await service.buildDiscoveryFeed({ origin: 'FCO', limit: 5 });
  assert.equal(payload.skipped, true);

  const after = getDiscoveryFeedRuntimeMetrics();
  assert.equal(after.callsTotal >= before.callsTotal + 1, true);
  assert.equal(after.skippedTotal >= before.skippedTotal + 1, true);
});

test('discovery feed service keeps offers with unknown duration encoded as zero', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      distance_km INTEGER NULL
    );
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      provider TEXT NULL,
      origin_airport_id INTEGER NULL,
      destination_airport_id INTEGER NULL
    );
    CREATE TABLE airports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iata_code TEXT NOT NULL,
      city_name TEXT NOT NULL
    );
    CREATE TABLE detected_deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_key TEXT NOT NULL UNIQUE,
      flight_quote_id INTEGER NOT NULL,
      route_id INTEGER NOT NULL,
      deal_type TEXT NOT NULL,
      raw_score REAL NOT NULL,
      final_score REAL NOT NULL,
      deal_score REAL NULL,
      opportunity_level TEXT NOT NULL,
      price REAL NOT NULL,
      baseline_price REAL NULL,
      savings_amount REAL NULL,
      savings_pct REAL NULL,
      status TEXT NOT NULL,
      score_breakdown TEXT NOT NULL,
      published_at TEXT NULL,
      expires_at TEXT NULL,
      source_observed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.prepare(`INSERT INTO routes (id, origin_iata, destination_iata, distance_km) VALUES (?, ?, ?, ?)`).run(1, 'FCO', 'LIS', 1860);
  const now = Date.now();
  const depart = new Date(now + 30 * 24 * 60 * 60 * 1000);
  const ret = new Date(now + 37 * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO flight_quotes
      (id, route_id, departure_date, return_date, trip_type, cabin_class, currency, stops, duration_minutes, provider, origin_airport_id, destination_airport_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(1, 1, fmtDate(depart), fmtDate(ret), 'round_trip', 'economy', 'EUR', 1, 0, 'bootstrap', null, null);

  const isoHoursAgo = (h) => new Date(now - h * 60 * 60 * 1000).toISOString();
  const isoHoursAhead = (h) => new Date(now + h * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO detected_deals
      (deal_key, flight_quote_id, route_id, deal_type, raw_score, final_score, deal_score, opportunity_level, price, baseline_price, savings_amount, savings_pct, status, score_breakdown, published_at, expires_at, source_observed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'duration_zero_ok',
    1,
    1,
    'great_deal',
    75,
    79,
    79,
    'Exceptional price',
    199,
    250,
    51,
    20.4,
    'published',
    JSON.stringify({ signals: { route_popularity_30d: 10, user_signals_30d: 2 } }),
    isoHoursAgo(1),
    isoHoursAhead(72),
    isoHoursAgo(1),
    isoHoursAgo(1)
  );

  const service = createDiscoveryFeedService({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const payload = await service.buildDiscoveryFeed({ origin: 'FCO', limit: 5 });
  assert.equal(payload.skipped, false);
  assert.equal(payload.meta.source_rows, 1);
  assert.equal(payload.meta.valid_candidates, 1);
  assert.equal(payload.queries.top_offers.length, 1);
  assert.equal(payload.queries.top_offers[0].deal_key, 'duration_zero_ok');
  assert.equal(Number(payload.meta?.rejected_by_reason?.unrealistic_duration || 0), 0);
});

test('discovery feed service uses stale fallback only when primary freshness window is empty', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      distance_km INTEGER NULL
    );
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      provider TEXT NULL,
      origin_airport_id INTEGER NULL,
      destination_airport_id INTEGER NULL
    );
    CREATE TABLE airports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iata_code TEXT NOT NULL,
      city_name TEXT NOT NULL
    );
    CREATE TABLE detected_deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_key TEXT NOT NULL UNIQUE,
      flight_quote_id INTEGER NOT NULL,
      route_id INTEGER NOT NULL,
      deal_type TEXT NOT NULL,
      raw_score REAL NOT NULL,
      final_score REAL NOT NULL,
      deal_score REAL NULL,
      opportunity_level TEXT NOT NULL,
      price REAL NOT NULL,
      baseline_price REAL NULL,
      savings_amount REAL NULL,
      savings_pct REAL NULL,
      status TEXT NOT NULL,
      score_breakdown TEXT NOT NULL,
      published_at TEXT NULL,
      expires_at TEXT NULL,
      source_observed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.prepare(`INSERT INTO routes (id, origin_iata, destination_iata, distance_km) VALUES (?, ?, ?, ?)`).run(1, 'FCO', 'JFK', 6900);
  const now = Date.now();
  const depart = new Date(now + 30 * 24 * 60 * 60 * 1000);
  const ret = new Date(now + 37 * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO flight_quotes
      (id, route_id, departure_date, return_date, trip_type, cabin_class, currency, stops, duration_minutes, provider, origin_airport_id, destination_airport_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(1, 1, fmtDate(depart), fmtDate(ret), 'round_trip', 'economy', 'EUR', 1, 620, 'mock', null, null);

  const isoHoursAgo = (h) => new Date(now - h * 60 * 60 * 1000).toISOString();
  const isoHoursAhead = (h) => new Date(now + h * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO detected_deals
      (deal_key, flight_quote_id, route_id, deal_type, raw_score, final_score, deal_score, opportunity_level, price, baseline_price, savings_amount, savings_pct, status, score_breakdown, published_at, expires_at, source_observed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'stale_fallback_candidate',
    1,
    1,
    'great_deal',
    80,
    84,
    84,
    'Great deal',
    299,
    540,
    241,
    44.63,
    'published',
    JSON.stringify({ signals: { route_popularity_30d: 40, user_signals_30d: 6 } }),
    isoHoursAgo(80),
    isoHoursAhead(48),
    isoHoursAgo(80),
    isoHoursAgo(80)
  );

  const serviceWithFallback = createDiscoveryFeedService({
    mode: 'sqlite',
    sqliteDb: db,
    feedMaxAgeHours: 72,
    feedStaleFallbackEnabled: true,
    feedStaleFallbackMaxAgeHours: 168,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const payloadWithFallback = await serviceWithFallback.buildDiscoveryFeed({ origin: 'FCO', limit: 5 });
  assert.equal(payloadWithFallback.skipped, false);
  assert.equal(payloadWithFallback.meta.source_rows, 1);
  assert.equal(payloadWithFallback.meta.valid_candidates, 1);
  assert.equal(payloadWithFallback.meta.freshness_fallback_used, true);
  assert.equal(payloadWithFallback.meta.freshness_primary_max_age_hours, 72);
  assert.equal(payloadWithFallback.meta.freshness_effective_max_age_hours, 168);
  assert.equal(payloadWithFallback.queries.top_offers.length, 1);
  assert.equal(payloadWithFallback.queries.top_offers[0].deal_key, 'stale_fallback_candidate');

  const serviceWithoutFallback = createDiscoveryFeedService({
    mode: 'sqlite',
    sqliteDb: db,
    feedMaxAgeHours: 72,
    feedStaleFallbackEnabled: false,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const payloadWithoutFallback = await serviceWithoutFallback.buildDiscoveryFeed({ origin: 'FCO', limit: 5 });
  assert.equal(payloadWithoutFallback.skipped, false);
  assert.equal(payloadWithoutFallback.meta.source_rows, 0);
  assert.equal(payloadWithoutFallback.meta.valid_candidates, 0);
  assert.equal(payloadWithoutFallback.meta.total_candidates, 0);
  assert.equal(payloadWithoutFallback.meta.freshness_fallback_used, false);
  assert.equal(payloadWithoutFallback.queries.top_offers.length, 0);
});

test('discovery feed service can fallback to candidate deals when published feed is empty', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      distance_km INTEGER NULL
    );
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      provider TEXT NULL,
      origin_airport_id INTEGER NULL,
      destination_airport_id INTEGER NULL
    );
    CREATE TABLE airports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iata_code TEXT NOT NULL,
      city_name TEXT NOT NULL
    );
    CREATE TABLE detected_deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_key TEXT NOT NULL UNIQUE,
      flight_quote_id INTEGER NOT NULL,
      route_id INTEGER NOT NULL,
      deal_type TEXT NOT NULL,
      raw_score REAL NOT NULL,
      final_score REAL NOT NULL,
      deal_score REAL NULL,
      opportunity_level TEXT NOT NULL,
      price REAL NOT NULL,
      baseline_price REAL NULL,
      savings_amount REAL NULL,
      savings_pct REAL NULL,
      status TEXT NOT NULL,
      score_breakdown TEXT NOT NULL,
      published_at TEXT NULL,
      expires_at TEXT NULL,
      source_observed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.prepare(`INSERT INTO routes (id, origin_iata, destination_iata, distance_km) VALUES (?, ?, ?, ?)`).run(1, 'FCO', 'JFK', 6900);
  const now = Date.now();
  const depart = new Date(now + 25 * 24 * 60 * 60 * 1000);
  const ret = new Date(now + 32 * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO flight_quotes
      (id, route_id, departure_date, return_date, trip_type, cabin_class, currency, stops, duration_minutes, provider, origin_airport_id, destination_airport_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(1, 1, fmtDate(depart), fmtDate(ret), 'round_trip', 'economy', 'EUR', 1, 620, 'mock', null, null);

  const isoHoursAgo = (h) => new Date(now - h * 60 * 60 * 1000).toISOString();
  const isoHoursAhead = (h) => new Date(now + h * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO detected_deals
      (deal_key, flight_quote_id, route_id, deal_type, raw_score, final_score, deal_score, opportunity_level, price, baseline_price, savings_amount, savings_pct, status, score_breakdown, published_at, expires_at, source_observed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'candidate_only_1',
    1,
    1,
    'great_deal',
    64,
    66,
    66,
    'Great deal',
    259,
    420,
    161,
    38.33,
    'candidate',
    JSON.stringify({ signals: { route_popularity_30d: 32, user_signals_30d: 4 } }),
    null,
    isoHoursAhead(72),
    isoHoursAgo(2),
    isoHoursAgo(2)
  );

  const serviceWithFallback = createDiscoveryFeedService({
    mode: 'sqlite',
    sqliteDb: db,
    feedCandidateFallbackEnabled: true,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const payloadWithFallback = await serviceWithFallback.buildDiscoveryFeed({ origin: 'FCO', limit: 5 });
  assert.equal(payloadWithFallback.skipped, false);
  assert.equal(payloadWithFallback.meta.source_rows, 1);
  assert.equal(payloadWithFallback.meta.valid_candidates, 1);
  assert.equal(payloadWithFallback.meta.candidate_fallback_used, true);
  assert.equal(payloadWithFallback.queries.top_offers.length, 1);
  assert.equal(payloadWithFallback.queries.top_offers[0].deal_key, 'candidate_only_1');
  assert.equal(payloadWithFallback.queries.top_offers[0].status, 'candidate');

  const serviceWithoutFallback = createDiscoveryFeedService({
    mode: 'sqlite',
    sqliteDb: db,
    feedCandidateFallbackEnabled: false,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const payloadWithoutFallback = await serviceWithoutFallback.buildDiscoveryFeed({ origin: 'FCO', limit: 5 });
  assert.equal(payloadWithoutFallback.skipped, false);
  assert.equal(payloadWithoutFallback.meta.source_rows, 0);
  assert.equal(payloadWithoutFallback.meta.valid_candidates, 0);
  assert.equal(payloadWithoutFallback.meta.total_candidates, 0);
  assert.equal(payloadWithoutFallback.meta.candidate_fallback_used, false);
  assert.equal(payloadWithoutFallback.queries.top_offers.length, 0);
});
