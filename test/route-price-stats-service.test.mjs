import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoutePriceStatsService } from '../server/lib/route-price-stats-service.js';

async function createMemoryDb() {
  const sqlite = await import('node:sqlite');
  return new sqlite.DatabaseSync(':memory:');
}

test('route price stats service aggregates flight quotes into route_price_stats', async () => {
  const db = await createMemoryDb();
  db.exec(`
    CREATE TABLE flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      departure_date TEXT NOT NULL,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_price REAL NOT NULL,
      observed_at TEXT NOT NULL
    );
  `);

  const now = Date.now();
  const d = (daysAgo) => new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString();

  const insert = db.prepare(
    `INSERT INTO flight_quotes (route_id, departure_date, trip_type, cabin_class, currency, total_price, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  insert.run(1, '2026-09-10', 'round_trip', 'economy', 'EUR', 100, d(2));
  insert.run(1, '2026-09-12', 'round_trip', 'economy', 'EUR', 200, d(8));
  insert.run(1, '2026-09-15', 'round_trip', 'economy', 'EUR', 300, d(20));

  const service = createRoutePriceStatsService({
    mode: 'sqlite',
    sqliteDb: db,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const refresh = await service.refreshRoutePriceStats();
  assert.equal(refresh.skipped, false);
  assert.equal(refresh.groupedRows, 1);
  assert.equal(refresh.quoteCount, 3);

  const row = db
    .prepare(
      `SELECT route_id, departure_month, quotes_count, min_price, max_price, avg_price, avg_price_7d, avg_price_30d
       FROM route_price_stats
       WHERE route_id = 1`
    )
    .get();

  assert.equal(Number(row.route_id), 1);
  assert.equal(String(row.departure_month), '2026-09-01');
  assert.equal(Number(row.quotes_count), 3);
  assert.equal(Number(row.min_price), 100);
  assert.equal(Number(row.max_price), 300);
  assert.equal(Number(row.avg_price), 200);
  assert.equal(Number(row.avg_price_7d), 100);
  assert.equal(Number(row.avg_price_30d), 200);
});
