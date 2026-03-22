import assert from 'node:assert/strict';
import test from 'node:test';
import { createDetectedDealsEngine } from '../server/lib/detected-deals-engine.js';

async function createMemoryDb() {
  const sqlite = await import('node:sqlite');
  return new sqlite.DatabaseSync(':memory:');
}

test('detected deals engine stores only realistic high-value deals', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_price REAL NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      is_bookable INTEGER NOT NULL DEFAULT 1,
      observed_at TEXT NOT NULL
    );
    CREATE TABLE route_price_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_month TEXT NOT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      quotes_count INTEGER NOT NULL,
      min_price REAL NOT NULL,
      max_price REAL NULL,
      avg_price REAL NOT NULL,
      avg_price_7d REAL NULL,
      avg_price_30d REAL NULL,
      confidence_level TEXT NOT NULL
    );
    CREATE TABLE user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NULL,
      event_type TEXT NOT NULL,
      event_ts TEXT NOT NULL
    );
  `);

  const now = Date.now();
  const isoHoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();

  const insertQuote = db.prepare(
    `INSERT INTO flight_quotes
      (route_id, departure_date, return_date, trip_type, cabin_class, currency, total_price, stops, duration_minutes, is_bookable, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertQuote.run(1, '2026-09-10', '2026-09-18', 'round_trip', 'economy', 'EUR', 160, 1, 520, 1, isoHoursAgo(12));
  insertQuote.run(1, '2026-09-10', '2026-09-18', 'round_trip', 'economy', 'EUR', 95, 1, 520, 1, isoHoursAgo(2));
  insertQuote.run(2, '2026-09-15', '2026-09-22', 'round_trip', 'economy', 'EUR', 170, 1, 510, 1, isoHoursAgo(2));

  const insertStats = db.prepare(
    `INSERT INTO route_price_stats
      (route_id, departure_month, trip_type, cabin_class, currency, quotes_count, min_price, max_price, avg_price, avg_price_7d, avg_price_30d, confidence_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertStats.run(1, '2026-09-01', 'round_trip', 'economy', 'EUR', 120, 90, 280, 180, 150, 210, 'high');
  insertStats.run(2, '2026-09-01', 'round_trip', 'economy', 'EUR', 90, 110, 320, 190, 180, 200, 'medium');

  const insertEvent = db.prepare(`INSERT INTO user_events (route_id, event_type, event_ts) VALUES (?, ?, ?)`);
  insertEvent.run(1, 'deal_view', isoHoursAgo(3));
  insertEvent.run(1, 'deal_save', isoHoursAgo(2));

  const engine = createDetectedDealsEngine({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const result = await engine.detectDeals();
  assert.equal(result.skipped, false);
  assert.equal(result.processedQuotes, 3);
  assert.equal(result.validDeals, 1);
  assert.equal(result.selectedDeals, 1);
  assert.equal(result.publishedDeals, 1);
  assert.equal(result.insertedDeals, 1);

  const dealRow = db
    .prepare(
      `SELECT price, baseline_price, savings_pct, deal_score, status, score_breakdown
       FROM detected_deals
       ORDER BY final_score DESC
       LIMIT 1`
    )
    .get();

  assert.equal(Number(dealRow.price), 95);
  assert.equal(Number(dealRow.baseline_price), 180);
  assert.equal(dealRow.status, 'published');
  assert.equal(Number(dealRow.savings_pct) > 40, true);
  assert.equal(Number(dealRow.deal_score) > 0, true);
  const breakdown = JSON.parse(String(dealRow.score_breakdown || '{}'));
  assert.equal(typeof breakdown.components, 'object');
  assert.equal(typeof breakdown.signals, 'object');
  assert.equal(Math.abs(Number(breakdown?.feed_ranking?.deal_score || 0) - Number(dealRow.deal_score)) < 0.01, true);
});

test('detected deals engine promotes near-threshold candidate when no published deals exist', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_price REAL NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      is_bookable INTEGER NOT NULL DEFAULT 1,
      observed_at TEXT NOT NULL
    );
    CREATE TABLE route_price_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_month TEXT NOT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      quotes_count INTEGER NOT NULL,
      min_price REAL NOT NULL,
      max_price REAL NULL,
      avg_price REAL NOT NULL,
      avg_price_7d REAL NULL,
      avg_price_30d REAL NULL,
      confidence_level TEXT NOT NULL
    );
    CREATE TABLE user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NULL,
      event_type TEXT NOT NULL,
      event_ts TEXT NOT NULL
    );
  `);

  const now = Date.now();
  const isoHoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();
  const insertQuote = db.prepare(
    `INSERT INTO flight_quotes
      (route_id, departure_date, return_date, trip_type, cabin_class, currency, total_price, stops, duration_minutes, is_bookable, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertQuote.run(1, '2026-09-10', '2026-09-18', 'round_trip', 'economy', 'EUR', 320, 1, 720, 1, isoHoursAgo(12));
  insertQuote.run(1, '2026-09-10', '2026-09-18', 'round_trip', 'economy', 'EUR', 260, 1, 720, 1, isoHoursAgo(2));

  db.prepare(
    `INSERT INTO route_price_stats
      (route_id, departure_month, trip_type, cabin_class, currency, quotes_count, min_price, max_price, avg_price, avg_price_7d, avg_price_30d, confidence_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(1, '2026-09-01', 'round_trip', 'economy', 'EUR', 90, 250, 450, 300, 290, 310, 'medium');

  db.prepare(`INSERT INTO user_events (route_id, event_type, event_ts) VALUES (?, ?, ?)`).run(1, 'deal_view', isoHoursAgo(2));

  const engine = createDetectedDealsEngine({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const result = await engine.detectDeals({
    minScore: 50,
    publishScore: 68,
    publishFallbackEnabled: true,
    publishFallbackDelta: 15,
    publishFallbackMaxPerRun: 1
  });

  assert.equal(result.skipped, false);
  assert.equal(result.validDeals, 1);
  assert.equal(result.publishedDeals, 1);
  assert.equal(result.fallbackPromotedDeals, 1);
  assert.equal(Number(result.publishFallbackThreshold), 53);

  const row = db
    .prepare(`SELECT status, final_score, score_breakdown FROM detected_deals ORDER BY final_score DESC LIMIT 1`)
    .get();

  assert.equal(String(row.status), 'published');
  assert.equal(Number(row.final_score) < 68, true);
  const breakdown = JSON.parse(String(row.score_breakdown || '{}'));
  assert.equal(Boolean(breakdown?.gates?.publish_fallback), true);
  assert.equal(String(breakdown?.publish?.mode || ''), 'fallback');
});

test('detected deals engine boosts shorter itineraries in final score', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_price REAL NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      is_bookable INTEGER NOT NULL DEFAULT 1,
      observed_at TEXT NOT NULL
    );
    CREATE TABLE route_price_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_month TEXT NOT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      quotes_count INTEGER NOT NULL,
      min_price REAL NOT NULL,
      max_price REAL NULL,
      avg_price REAL NOT NULL,
      avg_price_7d REAL NULL,
      avg_price_30d REAL NULL,
      confidence_level TEXT NOT NULL
    );
    CREATE TABLE user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NULL,
      event_type TEXT NOT NULL,
      event_ts TEXT NOT NULL
    );
  `);

  const now = Date.now();
  const isoHoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();

  const insertQuote = db.prepare(
    `INSERT INTO flight_quotes
      (route_id, departure_date, return_date, trip_type, cabin_class, currency, total_price, stops, duration_minutes, is_bookable, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertQuote.run(1, '2026-09-10', '2026-09-18', 'round_trip', 'economy', 'EUR', 110, 1, 220, 1, isoHoursAgo(1));
  insertQuote.run(1, '2026-09-10', '2026-09-18', 'round_trip', 'economy', 'EUR', 110, 1, 1040, 1, isoHoursAgo(1));

  const insertStats = db.prepare(
    `INSERT INTO route_price_stats
      (route_id, departure_month, trip_type, cabin_class, currency, quotes_count, min_price, max_price, avg_price, avg_price_7d, avg_price_30d, confidence_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertStats.run(1, '2026-09-01', 'round_trip', 'economy', 'EUR', 90, 100, 280, 200, 180, 220, 'high');

  const insertEvent = db.prepare(`INSERT INTO user_events (route_id, event_type, event_ts) VALUES (?, ?, ?)`);
  insertEvent.run(1, 'deal_view', isoHoursAgo(2));
  insertEvent.run(1, 'deal_save', isoHoursAgo(1.5));

  const engine = createDetectedDealsEngine({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const result = await engine.detectDeals();
  assert.equal(result.skipped, false);
  assert.equal(result.validDeals, 2);

  const rows = db
    .prepare(
      `SELECT final_score, deal_score, score_breakdown
       FROM detected_deals
       ORDER BY final_score DESC`
    )
    .all();

  assert.equal(rows.length, 2);
  assert.equal(Number(rows[0].final_score) > Number(rows[1].final_score), true);
  assert.equal(Number(rows[0].deal_score) > 0, true);
  assert.equal(Number(rows[1].deal_score) > 0, true);

  const topBreakdown = JSON.parse(String(rows[0].score_breakdown || '{}'));
  const lowBreakdown = JSON.parse(String(rows[1].score_breakdown || '{}'));
  assert.equal(Number(topBreakdown?.components?.duration || 0) > Number(lowBreakdown?.components?.duration || 0), true);
});

test('detected deals engine allows bootstrap fallback when historical stats are sparse', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_price REAL NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      is_bookable INTEGER NOT NULL DEFAULT 1,
      observed_at TEXT NOT NULL,
      source TEXT NULL,
      metadata TEXT NULL
    );
    CREATE TABLE route_price_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_month TEXT NOT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      quotes_count INTEGER NOT NULL,
      min_price REAL NOT NULL,
      max_price REAL NULL,
      avg_price REAL NOT NULL,
      avg_price_7d REAL NULL,
      avg_price_30d REAL NULL,
      confidence_level TEXT NOT NULL
    );
    CREATE TABLE user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NULL,
      event_type TEXT NOT NULL,
      event_ts TEXT NOT NULL
    );
  `);

  const now = Date.now();
  const isoHoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();
  const insertQuote = db.prepare(
    `INSERT INTO flight_quotes
      (route_id, departure_date, return_date, trip_type, cabin_class, currency, total_price, stops, duration_minutes, is_bookable, observed_at, source, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertQuote.run(
    1,
    '2026-09-10',
    '2026-09-18',
    'round_trip',
    'economy',
    'EUR',
    240,
    0,
    500,
    1,
    isoHoursAgo(1),
    'opportunity_bootstrap',
    JSON.stringify({
      bootstrap: true,
      finalScore: 79,
      baselinePrice: 272,
      savingsPct: 11.76,
      opportunityLevel: 'Exceptional price'
    })
  );
  insertQuote.run(1, '2026-09-10', '2026-09-18', 'round_trip', 'economy', 'EUR', 240, 0, 500, 1, isoHoursAgo(1), 'scan_worker', '{}');

  const insertStats = db.prepare(
    `INSERT INTO route_price_stats
      (route_id, departure_month, trip_type, cabin_class, currency, quotes_count, min_price, max_price, avg_price, avg_price_7d, avg_price_30d, confidence_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertStats.run(1, '2026-09-01', 'round_trip', 'economy', 'EUR', 1, 240, 240, 240, 240, 240, 'very_low');

  const engine = createDetectedDealsEngine({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const result = await engine.detectDeals();
  assert.equal(result.skipped, false);
  assert.equal(result.validDeals, 1);
  assert.equal(result.publishedDeals, 1);

  const row = db
    .prepare(`SELECT baseline_price, savings_pct, score_breakdown FROM detected_deals ORDER BY final_score DESC LIMIT 1`)
    .get();

  assert.equal(Number(row.baseline_price), 272);
  assert.equal(Number(row.savings_pct) >= 11, true);
  const breakdown = JSON.parse(String(row.score_breakdown || '{}'));
  assert.equal(Boolean(breakdown?.gates?.bootstrap_fallback), true);
});

test('detected deals engine enriches bootstrap metadata from travel opportunities when missing savings context', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_price REAL NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      is_bookable INTEGER NOT NULL DEFAULT 1,
      observed_at TEXT NOT NULL,
      source TEXT NULL,
      metadata TEXT NULL
    );
    CREATE TABLE route_price_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_month TEXT NOT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      quotes_count INTEGER NOT NULL,
      min_price REAL NOT NULL,
      max_price REAL NULL,
      avg_price REAL NOT NULL,
      avg_price_7d REAL NULL,
      avg_price_30d REAL NULL,
      confidence_level TEXT NOT NULL
    );
    CREATE TABLE user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NULL,
      event_type TEXT NOT NULL,
      event_ts TEXT NOT NULL
    );
    CREATE TABLE travel_opportunities (
      id TEXT PRIMARY KEY,
      price REAL NOT NULL,
      baseline_price REAL NULL,
      savings_percent_if_available REAL NULL,
      final_score REAL NULL,
      opportunity_level TEXT NULL
    );
  `);

  const now = Date.now();
  const isoHoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO flight_quotes
      (route_id, departure_date, return_date, trip_type, cabin_class, currency, total_price, stops, duration_minutes, is_bookable, observed_at, source, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    1,
    '2026-09-10',
    '2026-09-18',
    'round_trip',
    'economy',
    'EUR',
    240,
    0,
    500,
    1,
    isoHoursAgo(1),
    'opportunity_bootstrap',
    JSON.stringify({
      bootstrap: true,
      opportunityId: 'opp_1'
    })
  );

  db.prepare(
    `INSERT INTO route_price_stats
      (route_id, departure_month, trip_type, cabin_class, currency, quotes_count, min_price, max_price, avg_price, avg_price_7d, avg_price_30d, confidence_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(1, '2026-09-01', 'round_trip', 'economy', 'EUR', 1, 240, 240, 240, 240, 240, 'very_low');

  db.prepare(
    `INSERT INTO travel_opportunities
      (id, price, baseline_price, savings_percent_if_available, final_score, opportunity_level)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('opp_1', 240, 272, 11.76, 79, 'Exceptional price');

  const engine = createDetectedDealsEngine({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const result = await engine.detectDeals();
  assert.equal(result.skipped, false);
  assert.equal(result.validDeals, 1);

  const row = db
    .prepare(`SELECT baseline_price, savings_pct, final_score, opportunity_level FROM detected_deals ORDER BY final_score DESC LIMIT 1`)
    .get();

  assert.equal(Number(row.baseline_price), 272);
  assert.equal(Number(row.savings_pct) >= 11, true);
  assert.equal(Number(row.final_score) >= 79, true);
  assert.equal(String(row.opportunity_level), 'Exceptional price');
});

test('detected deals engine deletes expired rows older than retention window', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_price REAL NOT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      is_bookable INTEGER NOT NULL DEFAULT 1,
      observed_at TEXT NOT NULL
    );
    CREATE TABLE route_price_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_month TEXT NOT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      quotes_count INTEGER NOT NULL,
      min_price REAL NOT NULL,
      max_price REAL NULL,
      avg_price REAL NOT NULL,
      avg_price_7d REAL NULL,
      avg_price_30d REAL NULL,
      confidence_level TEXT NOT NULL
    );
    CREATE TABLE user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NULL,
      event_type TEXT NOT NULL,
      event_ts TEXT NOT NULL
    );
  `);

  const now = Date.now();
  const isoHoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO flight_quotes
      (id, route_id, departure_date, return_date, trip_type, cabin_class, currency, total_price, stops, duration_minutes, is_bookable, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(1, 1, '2026-09-10', '2026-09-18', 'round_trip', 'economy', 'EUR', 120, 1, 400, 1, isoHoursAgo(1));

  db.prepare(
    `INSERT INTO route_price_stats
      (route_id, departure_month, trip_type, cabin_class, currency, quotes_count, min_price, max_price, avg_price, avg_price_7d, avg_price_30d, confidence_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(1, '2026-09-01', 'round_trip', 'economy', 'EUR', 80, 100, 220, 180, 170, 195, 'high');

  const engine = createDetectedDealsEngine({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  await engine.detectDeals({ retentionDays: 30 });

  db.prepare(
    `INSERT INTO detected_deals
      (deal_key, flight_quote_id, route_id, deal_type, raw_score, final_score, deal_score, opportunity_level, price, baseline_price, savings_amount, savings_pct, status, rejection_reason, score_breakdown, published_at, expires_at, source_observed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'expired_old_retention_test',
    1,
    1,
    'great_deal',
    72,
    74,
    73,
    'Great deal',
    140,
    180,
    40,
    22.2,
    'expired',
    null,
    JSON.stringify({}),
    isoHoursAgo(24 * 90),
    isoHoursAgo(24 * 80),
    isoHoursAgo(24 * 90),
    isoHoursAgo(24 * 90),
    isoHoursAgo(24 * 90)
  );

  const second = await engine.detectDeals({ retentionDays: 30 });
  assert.equal(second.skipped, false);
  assert.equal(Number(second.deletedExpiredDeals || 0) >= 1, true);

  const staleRow = db.prepare(`SELECT deal_key FROM detected_deals WHERE deal_key = ?`).get('expired_old_retention_test');
  assert.equal(Boolean(staleRow), false);
});
