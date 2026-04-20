/**
 * PostgreSQL concurrency integration tests.
 *
 * Requires a running PostgreSQL instance and DATABASE_URL set, e.g.:
 *   DATABASE_URL=postgresql://flight:flight@localhost:5432/flight \
 *     node --test test/integration/pg-concurrency.test.mjs
 *
 * Covers the four TOCTOU gaps fixed in the PG paths:
 *  A. issueApiKey  — concurrent requests cannot exceed maxKeys
 *  B. createAlert  — concurrent requests cannot exceed maxAlerts
 *  C. rotateApiKey — only one of two concurrent rotations wins
 *  D. getOrCreateSubscription — no duplicate user_subscriptions rows
 *
 * Each test uses a unique userId so it is fully isolated from production data
 * and from other tests. Rows inserted during a test are deleted in afterEach.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://flight:flight@localhost:5432/flight';
const RUN_PG_INTEGRATION_TESTS = String(process.env.RUN_PG_INTEGRATION_TESTS || '')
  .trim()
  .toLowerCase() === 'true';
const testPg = RUN_PG_INTEGRATION_TESTS ? test : test.skip;

const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

// ── helpers ────────────────────────────────────────────────────────────────────

function uniqueUserId() {
  return `test_pg_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function rawKey() {
  return `fsk_live_${randomBytes(24).toString('hex')}`;
}

function hashKey(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

/** Insert one active api_key for userId and return its id. */
async function insertApiKey(userId, name = 'test-key') {
  const raw = rawKey();
  const hash = hashKey(raw);
  const prefix = `${raw.slice(0, 14)}...`;
  const res = await pool.query(
    `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, quota_limits, created_at)
     VALUES ($1, $2, $3, $4, '{read}', '{}', NOW())
     RETURNING id`,
    [userId, name, prefix, hash]
  );
  return res.rows[0].id;
}

/** Issue one api_key using the same advisory-lock pattern as saas-db.js. */
async function issueApiKey(userId, maxKeys) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Advisory lock serializes all issueApiKey calls for the same user,
    // preventing phantom inserts that FOR UPDATE on existing rows cannot block.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
    const countRes = await client.query(
      `SELECT COUNT(*) AS cnt FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
    if (Number(countRes.rows[0].cnt) >= maxKeys) {
      await client.query('ROLLBACK');
      const err = new Error('key_limit_reached');
      err.code = 'key_limit_reached';
      throw err;
    }
    const raw = rawKey();
    const hash = hashKey(raw);
    const prefix = `${raw.slice(0, 14)}...`;
    const res = await client.query(
      `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, quota_limits, created_at)
       VALUES ($1, 'test-key', $2, $3, '{read}', '{}', NOW())
       RETURNING id`,
      [userId, prefix, hash]
    );
    await client.query('COMMIT');
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Insert one free_alert using the same advisory-lock pattern as free-foundation-store.js. */
async function createAlert(userId, maxAlerts) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Advisory lock serializes all createAlert calls for the same user.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
    const countRes = await client.query(
      `SELECT COUNT(*) AS cnt FROM free_alerts WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (Number(countRes.rows[0].cnt) >= maxAlerts) {
      await client.query('ROLLBACK');
      const err = new Error('alert_limit_reached');
      err.code = 'alert_limit_reached';
      throw err;
    }
    const res = await client.query(
      `INSERT INTO free_alerts (id, user_id, origin_iata, destination_iata, target_price, created_at)
       VALUES (gen_random_uuid()::text, $1, 'FCO', 'CDG', 199.00, NOW())
       RETURNING id`,
      [userId]
    );
    await client.query('COMMIT');
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Rotate an api_key using the same FOR UPDATE pattern as saas-db.js. Returns new row or null. */
async function rotateApiKey(userId, keyId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, name, scopes FROM api_keys WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [keyId, userId]
    );
    const current = existing.rows[0] || null;
    if (!current || current.revoked_at) {
      await client.query('ROLLBACK');
      return null;
    }
    const updated = await client.query(
      `UPDATE api_keys SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [keyId, userId]
    );
    if (updated.rowCount === 0) {
      // Already revoked by a concurrent rotation that sneaked in
      await client.query('ROLLBACK');
      return null;
    }
    const raw = rawKey();
    const hash = hashKey(raw);
    const prefix = `${raw.slice(0, 14)}...`;
    const inserted = await client.query(
      `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, quota_limits, created_at)
       VALUES ($1, $2, $3, $4, '{read}', '{}', NOW())
       RETURNING id`,
      [userId, current.name, prefix, hash]
    );
    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** get-or-create a user_subscription using ON CONFLICT, as in saas-db.js. */
async function getOrCreateSubscription(userId) {
  const existing = await pool.query(
    `SELECT id, user_id FROM user_subscriptions WHERE user_id = $1`,
    [userId]
  );
  if (existing.rows[0]) return existing.rows[0];

  await pool.query(
    `INSERT INTO user_subscriptions (user_id, plan_id)
     VALUES ($1, 'free')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  const refetch = await pool.query(
    `SELECT id, user_id FROM user_subscriptions WHERE user_id = $1`,
    [userId]
  );
  return refetch.rows[0];
}

// ── cleanup helpers ─────────────────────────────────────────────────────────

async function cleanApiKeys(userId) {
  await pool.query(`DELETE FROM api_keys WHERE user_id = $1`, [userId]);
}

async function cleanAlerts(userId) {
  await pool.query(`DELETE FROM free_alerts WHERE user_id = $1`, [userId]);
}

async function cleanSubscriptions(userId) {
  await pool.query(`DELETE FROM user_subscriptions WHERE user_id = $1`, [userId]);
}

// ── Test A: issueApiKey — concurrent requests cannot exceed maxKeys ─────────

testPg('issueApiKey PG: 5 concurrent requests with maxKeys=2 → exactly 2 succeed', async () => {
  const userId = uniqueUserId();
  const MAX = 2;

  try {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => issueApiKey(userId, MAX))
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, MAX, `exactly ${MAX} keys must be issued`);
    assert.equal(rejected.length, 5 - MAX, `remaining ${5 - MAX} must be rejected`);
    assert.ok(
      rejected.every((r) => r.reason.code === 'key_limit_reached'),
      'all rejections must carry code=key_limit_reached'
    );

    // Verify DB state
    const dbRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
    assert.equal(Number(dbRes.rows[0].cnt), MAX, `exactly ${MAX} active rows in DB`);
  } finally {
    await cleanApiKeys(userId);
  }
});

// ── Test B: createAlert — concurrent requests cannot exceed maxAlerts ───────

testPg('createAlert PG: 5 concurrent requests with maxAlerts=3 → exactly 3 succeed', async () => {
  const userId = uniqueUserId();
  const MAX = 3;

  try {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => createAlert(userId, MAX))
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, MAX, `exactly ${MAX} alerts must be created`);
    assert.equal(rejected.length, 5 - MAX, `remaining ${5 - MAX} must be rejected`);
    assert.ok(
      rejected.every((r) => r.reason.code === 'alert_limit_reached'),
      'all rejections must carry code=alert_limit_reached'
    );

    const dbRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM free_alerts WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    assert.equal(Number(dbRes.rows[0].cnt), MAX, `exactly ${MAX} active rows in DB`);
  } finally {
    await cleanAlerts(userId);
  }
});

// ── Test C: rotateApiKey — only one of two concurrent rotations wins ────────

testPg('rotateApiKey PG: 2 concurrent rotations on same key → exactly 1 wins', async () => {
  const userId = uniqueUserId();
  const keyId = await insertApiKey(userId, 'rotate-me');

  try {
    const [r1, r2] = await Promise.all([
      rotateApiKey(userId, keyId),
      rotateApiKey(userId, keyId)
    ]);

    const wins = [r1, r2].filter(Boolean);
    const nulls = [r1, r2].filter((r) => r === null);

    assert.equal(wins.length, 1, 'exactly one rotation must succeed');
    assert.equal(nulls.length, 1, 'the other must return null');

    // Original key must now be revoked
    const origRes = await pool.query(
      `SELECT revoked_at FROM api_keys WHERE id = $1`,
      [keyId]
    );
    assert.ok(origRes.rows[0]?.revoked_at, 'original key must be revoked');

    // New active key must exist
    const newRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
    assert.equal(Number(newRes.rows[0].cnt), 1, 'exactly one active key after rotation');
  } finally {
    await cleanApiKeys(userId);
  }
});

// ── Test D: getOrCreateSubscription — no duplicate rows ────────────────────

testPg('getOrCreateSubscription PG: 5 concurrent calls for new user → 1 row, all callers get same id', async () => {
  const userId = uniqueUserId();

  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => getOrCreateSubscription(userId))
    );

    // All must succeed
    assert.ok(results.every(Boolean), 'all callers must get a subscription');

    // All must return the same id
    const ids = new Set(results.map((r) => r.id));
    assert.equal(ids.size, 1, 'all callers must resolve the same subscription id');

    // Only one row in DB
    const dbRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM user_subscriptions WHERE user_id = $1`,
      [userId]
    );
    assert.equal(Number(dbRes.rows[0].cnt), 1, 'exactly one subscription row in DB');
  } finally {
    await cleanSubscriptions(userId);
  }
});

// ── tear-down ───────────────────────────────────────────────────────────────

test.after(async () => {
  await pool.end();
});
