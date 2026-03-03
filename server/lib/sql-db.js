import { mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

let sqliteDb = null;
let pgPool = null;
let mode = 'sqlite';

const DB_FILE_URL = new URL('../../data/app.db', import.meta.url);
const DB_FILE_PATH = fileURLToPath(DB_FILE_URL);
const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function runPgMigrations() {
  const pool = pgPool;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const appliedRows = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRows.rows.map((r) => r.version));

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function ensurePg() {
  if (!pgPool) {
    pgPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL
    });
  }
  await runPgMigrations();
}

async function ensureSqlite() {
  if (sqliteDb) return;
  await mkdir(dirname(DB_FILE_PATH), { recursive: true });
  const module = await import('node:sqlite');
  sqliteDb = new module.DatabaseSync(DB_FILE_PATH);
  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS user_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'register',
      channel TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS search_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'unknown',
      origin TEXT NOT NULL,
      region TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_delivery_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_message_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export async function initSqlDb() {
  if (process.env.DATABASE_URL) {
    mode = 'postgres';
    await ensurePg();
    return;
  }
  mode = 'sqlite';
  await ensureSqlite();
}

export async function upsertUserLead({ userId, email, name, source = 'register', channel = 'unknown' }) {
  const now = new Date().toISOString();
  if (mode === 'postgres') {
    await pgPool.query(
      `INSERT INTO user_leads (user_id, email, name, source, channel, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name, source=EXCLUDED.source, channel=EXCLUDED.channel, updated_at=NOW()`,
      [userId, email, name, source, channel]
    );
    return;
  }
  sqliteDb
    .prepare(
      `INSERT INTO user_leads (user_id, email, name, source, channel, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, name=excluded.name, source=excluded.source, channel=excluded.channel, updated_at=excluded.updated_at`
    )
    .run(userId, email, name, source, channel, now, now);
}

export async function insertSearchEvent({ userId, channel = 'unknown', origin, region, dateFrom, dateTo }) {
  if (mode === 'postgres') {
    await pgPool.query(
      `INSERT INTO search_events (user_id, channel, origin, region, date_from, date_to, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId, channel, origin, region, dateFrom, dateTo]
    );
    return;
  }
  sqliteDb
    .prepare(`INSERT INTO search_events (user_id, channel, origin, region, date_from, date_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, channel, origin, region, dateFrom, dateTo, new Date().toISOString());
}

export async function insertEmailDeliveryLog({ userId, email, subject, status, providerMessageId = null, errorMessage = null }) {
  if (mode === 'postgres') {
    await pgPool.query(
      `INSERT INTO email_delivery_log (user_id, email, subject, status, provider_message_id, error_message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId || null, email, subject, status, providerMessageId, errorMessage]
    );
    return;
  }
  sqliteDb
    .prepare(
      `INSERT INTO email_delivery_log (user_id, email, subject, status, provider_message_id, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId || null, email, subject, status, providerMessageId, errorMessage, new Date().toISOString());
}

export async function getBusinessMetrics() {
  if (mode === 'postgres') {
    const [leadRows, searchRows, sentRows, failedRows, lead7Rows, search7Rows] = await Promise.all([
      pgPool.query('SELECT COUNT(*)::int AS value FROM user_leads'),
      pgPool.query('SELECT COUNT(*)::int AS value FROM search_events'),
      pgPool.query("SELECT COUNT(*)::int AS value FROM email_delivery_log WHERE status='sent'"),
      pgPool.query("SELECT COUNT(*)::int AS value FROM email_delivery_log WHERE status='failed'"),
      pgPool.query("SELECT COUNT(*)::int AS value FROM user_leads WHERE created_at >= NOW() - INTERVAL '7 days'"),
      pgPool.query("SELECT COUNT(*)::int AS value FROM search_events WHERE created_at >= NOW() - INTERVAL '7 days'")
    ]);
    const leads = toNumber(leadRows.rows[0]?.value);
    const searches = toNumber(searchRows.rows[0]?.value);
    const emailsSent = toNumber(sentRows.rows[0]?.value);
    const emailsFailed = toNumber(failedRows.rows[0]?.value);
    const last7dLeads = toNumber(lead7Rows.rows[0]?.value);
    const last7dSearches = toNumber(search7Rows.rows[0]?.value);
    return {
      leads,
      searches,
      emailsSent,
      emailsFailed,
      last7dLeads,
      last7dSearches,
      searchPerLead: leads > 0 ? Math.round((searches / leads) * 100) / 100 : 0
    };
  }

  const leads = sqliteDb.prepare('SELECT COUNT(*) as value FROM user_leads').get()?.value || 0;
  const searches = sqliteDb.prepare('SELECT COUNT(*) as value FROM search_events').get()?.value || 0;
  const emailsSent = sqliteDb.prepare("SELECT COUNT(*) as value FROM email_delivery_log WHERE status = 'sent'").get()?.value || 0;
  const emailsFailed = sqliteDb.prepare("SELECT COUNT(*) as value FROM email_delivery_log WHERE status = 'failed'").get()?.value || 0;
  const last7dLeads = sqliteDb.prepare("SELECT COUNT(*) as value FROM user_leads WHERE datetime(created_at) >= datetime('now', '-7 day')").get()?.value || 0;
  const last7dSearches = sqliteDb.prepare("SELECT COUNT(*) as value FROM search_events WHERE datetime(created_at) >= datetime('now', '-7 day')").get()?.value || 0;
  return {
    leads,
    searches,
    emailsSent,
    emailsFailed,
    last7dLeads,
    last7dSearches,
    searchPerLead: leads > 0 ? Math.round((searches / leads) * 100) / 100 : 0
  };
}

export async function getFunnelMetricsByChannel() {
  if (mode === 'postgres') {
    const leadRows = await pgPool.query('SELECT channel, COUNT(*)::int AS leads FROM user_leads GROUP BY channel');
    const searchRows = await pgPool.query('SELECT channel, COUNT(*)::int AS searches FROM search_events GROUP BY channel');
    const leadMap = new Map(leadRows.rows.map((r) => [r.channel || 'unknown', toNumber(r.leads)]));
    const searchMap = new Map(searchRows.rows.map((r) => [r.channel || 'unknown', toNumber(r.searches)]));
    const channels = new Set([...leadMap.keys(), ...searchMap.keys()]);
    const items = [...channels]
      .map((channel) => {
        const leads = toNumber(leadMap.get(channel));
        const searches = toNumber(searchMap.get(channel));
        return {
          channel,
          leads,
          searches,
          searchesPerLead: leads > 0 ? Math.round((searches / leads) * 100) / 100 : 0
        };
      })
      .sort((a, b) => b.leads - a.leads || b.searches - a.searches);
    return { items };
  }

  const leadRows = sqliteDb.prepare(`SELECT channel, COUNT(*) as leads FROM user_leads GROUP BY channel`).all();
  const searchRows = sqliteDb.prepare(`SELECT channel, COUNT(*) as searches FROM search_events GROUP BY channel`).all();
  const searchMap = new Map(searchRows.map((row) => [row.channel || 'unknown', Number(row.searches || 0)]));
  const channels = new Set([...leadRows.map((r) => r.channel || 'unknown'), ...searchRows.map((r) => r.channel || 'unknown')]);
  const items = [...channels]
    .map((channel) => {
      const leads = Number(leadRows.find((r) => (r.channel || 'unknown') === channel)?.leads || 0);
      const searches = Number(searchMap.get(channel) || 0);
      return {
        channel,
        leads,
        searches,
        searchesPerLead: leads > 0 ? Math.round((searches / leads) * 100) / 100 : 0
      };
    })
    .sort((a, b) => b.leads - a.leads || b.searches - a.searches);
  return { items };
}
