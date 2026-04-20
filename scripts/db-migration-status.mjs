import 'dotenv/config';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../server/migrations', import.meta.url));

function fail(message, detail = null) {
  const out = detail ? `${message} :: ${detail}` : message;
  throw new Error(out);
}

async function readMigrationFiles() {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  return files.map((name) => name.replace(/\.sql$/, ''));
}

async function run() {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) fail('DATABASE_URL is required');

  const pool = new pg.Pool({ connectionString });
  try {
    const expected = await readMigrationFiles();
    if (expected.length === 0) fail('No migration files found', MIGRATIONS_DIR);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const rows = await pool.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set((rows.rows || []).map((row) => String(row.version || '').trim()).filter(Boolean));
    const pending = expected.filter((version) => !appliedSet.has(version));
    const unknownApplied = [...appliedSet].filter((version) => !expected.includes(version)).sort();

    console.log(`[db-migration-status] expected=${expected.length} applied=${appliedSet.size} pending=${pending.length}`);

    if (unknownApplied.length > 0) {
      console.warn(`[WARN] Unknown applied migration versions found: ${unknownApplied.join(', ')}`);
    }
    if (pending.length > 0) {
      fail('Pending migrations found', pending.join(', '));
    }

    console.log('[db-migration-status] OK');
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[db-migration-status] FAILED');
  console.error(error?.message || error);
  process.exit(1);
});
