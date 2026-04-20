import { nanoid } from 'nanoid';
import { withDb, readDb } from './db.js';
import { getSaasPool } from './saas-db.js';

function budgetToBucket(budget) {
  const value = Number(budget || 0);
  if (value <= 350) return 'low';
  if (value <= 900) return 'mid';
  return 'high';
}

export function utcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function getDefaultFreeLimits() {
  return {
    daily_search_limit: Number(process.env.FREE_DAILY_SEARCH_LIMIT || 100),
    active_alert_limit: Number(process.env.FREE_ACTIVE_ALERT_LIMIT || 5),
    demo_daily_search_limit: Number(process.env.DEMO_DAILY_SEARCH_LIMIT || 15),
    demo_minute_ip_limit: Number(process.env.DEMO_MINUTE_IP_LIMIT || 20),
    demo_minute_device_limit: Number(process.env.DEMO_MINUTE_DEVICE_LIMIT || 30),
    user_minute_limit: Number(process.env.FREE_USER_MINUTE_LIMIT || 60)
  };
}

export async function createUserIfNotExists({ name, email, passwordHash }) {
  const normalizedEmail = cleanEmail(email);
  let created = null;
  let existing = null;

  await withDb(async (db) => {
    const found = (db.users || []).find((u) => cleanEmail(u.email) === normalizedEmail);
    if (found) {
      existing = found;
      return null;
    }
    created = {
      id: nanoid(16),
      name: String(name || '').trim(),
      email: normalizedEmail,
      passwordHash,
      isPremium: false,
      onboardingDone: false,
      authChannel: 'direct',
      createdAt: new Date().toISOString()
    };
    db.users.push(created);
    return db;
  });

  return { created, existing };
}

export async function getUserByEmail(email) {
  const normalizedEmail = cleanEmail(email);
  const db = await readDb();
  return (db.users || []).find((u) => cleanEmail(u.email) === normalizedEmail) || null;
}

export async function getUserById(id) {
  const db = await readDb();
  return (db.users || []).find((u) => u.id === id) || null;
}

export async function getJustGoPrecomputed({ origin, budget, season, mood, limit = 3 }) {
  const pool = getSaasPool();
  const scoreDate = utcDateString();
  const budgetBucket = budgetToBucket(budget);

  if (pool) {
    const result = await pool.query(
      `SELECT destination_iata, destination_city, rank_position, final_score, travel_score
       FROM free_destination_rankings_daily
       WHERE score_date = $1
         AND origin_iata = $2
         AND budget_bucket = $3
         AND season = $4
         AND mood = $5
       ORDER BY rank_position ASC
       LIMIT $6`,
      [scoreDate, String(origin || '').toUpperCase(), budgetBucket, season, mood, Number(limit || 3)]
    );
    return result.rows;
  }

  const db = await readDb();
  const rows = (db.freePrecomputedRankings || [])
    .filter((row) =>
      row.scoreDate === scoreDate &&
      row.originIata === String(origin || '').toUpperCase() &&
      row.budgetBucket === budgetBucket &&
      row.season === season &&
      row.mood === mood
    )
    .sort((a, b) => Number(a.rankPosition) - Number(b.rankPosition))
    .slice(0, Number(limit || 3))
    .map((row) => ({
      destination_iata: row.destinationIata,
      destination_city: row.destinationCity,
      rank_position: row.rankPosition,
      final_score: row.finalScore,
      travel_score: row.travelScore
    }));
  return rows;
}

export async function getTravelScore({ origin, destinationIata }) {
  const pool = getSaasPool();
  const scoreDate = utcDateString();
  if (pool) {
    const result = await pool.query(
      `SELECT origin_iata, destination_iata, destination_city, travel_score,
              flight_factor, lodging_factor, climate_factor, crowding_factor, seasonality_factor, events_factor
       FROM free_travel_scores_daily
       WHERE score_date = $1 AND origin_iata = $2 AND destination_iata = $3
       LIMIT 1`,
      [scoreDate, String(origin || '').toUpperCase(), String(destinationIata || '').toUpperCase()]
    );
    return result.rows[0] || null;
  }
  const db = await readDb();
  return (
    (db.freeTravelScores || []).find(
      (row) =>
        row.scoreDate === scoreDate &&
        row.originIata === String(origin || '').toUpperCase() &&
        row.destinationIata === String(destinationIata || '').toUpperCase()
    ) || null
  );
}

export async function listAlerts(userId) {
  const pool = getSaasPool();
  if (pool) {
    const result = await pool.query(
      `SELECT id, user_id, origin_iata, destination_iata, target_price, created_at
       FROM free_alerts
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }
  const db = await readDb();
  return (db.freeAlerts || [])
    .filter((a) => a.userId === userId && !a.deletedAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function countActiveAlerts(userId) {
  const pool = getSaasPool();
  if (pool) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM free_alerts
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    return Number(result.rows[0]?.c || 0);
  }
  const db = await readDb();
  return (db.freeAlerts || []).filter((a) => a.userId === userId && !a.deletedAt).length;
}

export async function createAlert({ userId, originIata, destinationIata, targetPrice, maxAlerts = null }) {
  const pool = getSaasPool();
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (maxAlerts !== null) {
        // Advisory lock serializes all createAlert calls for the same user,
        // preventing phantom inserts that FOR UPDATE on existing rows cannot block.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
        const countRes = await client.query(
          `SELECT COUNT(*) AS cnt FROM free_alerts WHERE user_id = $1 AND deleted_at IS NULL`,
          [userId]
        );
        if (Number(countRes.rows[0].cnt) >= maxAlerts) {
          await client.query('ROLLBACK');
          const err = new Error('Alert limit reached.');
          err.code = 'alert_limit_reached';
          throw err;
        }
      }
      const result = await client.query(
        `INSERT INTO free_alerts (id, user_id, origin_iata, destination_iata, target_price, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id, user_id, origin_iata, destination_iata, target_price, created_at`,
        [nanoid(16), userId, originIata, destinationIata, Number(targetPrice)]
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  let alert = null;
  let limitError = null;
  await withDb(async (db) => {
    if (maxAlerts !== null) {
      const activeCount = (db.freeAlerts || []).filter((a) => a.userId === userId && !a.deletedAt).length;
      if (activeCount >= maxAlerts) {
        limitError = true;
        return db;
      }
    }
    alert = {
      id: nanoid(16),
      userId,
      originIata,
      destinationIata,
      targetPrice: Number(targetPrice),
      createdAt: new Date().toISOString(),
      deletedAt: null
    };
    db.freeAlerts = db.freeAlerts || [];
    db.freeAlerts.push(alert);
    return db;
  });

  if (limitError) {
    const err = new Error('Alert limit reached.');
    err.code = 'alert_limit_reached';
    throw err;
  }

  return alert;
}

export async function deleteAlert({ userId, alertId }) {
  const pool = getSaasPool();
  if (pool) {
    const result = await pool.query(
      `UPDATE free_alerts
       SET deleted_at = NOW()
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [alertId, userId]
    );
    return Boolean(result.rows[0]);
  }
  let deleted = false;
  await withDb(async (db) => {
    db.freeAlerts = (db.freeAlerts || []).map((a) => {
      if (a.id === alertId && a.userId === userId && !a.deletedAt) {
        deleted = true;
        return { ...a, deletedAt: new Date().toISOString() };
      }
      return a;
    });
    return db;
  });
  return deleted;
}

export async function upsertNightlyPrecompute({ rankings, scores, signals, scoreDate }) {
  const pool = getSaasPool();
  const date = scoreDate || utcDateString();

  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM free_destination_rankings_daily WHERE score_date = $1', [date]);
      await client.query('DELETE FROM free_travel_scores_daily WHERE score_date = $1', [date]);
      await client.query('DELETE FROM free_alert_signals_daily WHERE score_date = $1', [date]);

      for (const row of rankings) {
        await client.query(
          `INSERT INTO free_destination_rankings_daily
           (score_date, origin_iata, budget_bucket, season, mood, destination_iata, destination_city, rank_position, final_score, travel_score, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
          [date, row.originIata, row.budgetBucket, row.season, row.mood, row.destinationIata, row.destinationCity, row.rankPosition, row.finalScore, row.travelScore]
        );
      }

      for (const row of scores) {
        await client.query(
          `INSERT INTO free_travel_scores_daily
           (score_date, origin_iata, destination_iata, destination_city, travel_score, flight_factor, lodging_factor, climate_factor, crowding_factor, seasonality_factor, events_factor, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
          [date, row.originIata, row.destinationIata, row.destinationCity, row.travelScore, row.flightFactor, row.lodgingFactor, row.climateFactor, row.crowdingFactor, row.seasonalityFactor, row.eventsFactor]
        );
      }

      for (const row of signals) {
        await client.query(
          `INSERT INTO free_alert_signals_daily
           (score_date, origin_iata, destination_iata, strategic_window_start, strategic_window_end, anomaly_price_threshold, trend_direction, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
          [date, row.originIata, row.destinationIata, row.strategicWindowStart, row.strategicWindowEnd, row.anomalyPriceThreshold, row.trendDirection]
        );
      }

      await client.query('COMMIT');
      return;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await withDb(async (db) => {
    db.freePrecomputedRankings = (db.freePrecomputedRankings || []).filter((r) => r.scoreDate !== date);
    db.freeTravelScores = (db.freeTravelScores || []).filter((r) => r.scoreDate !== date);
    db.freeAlertSignals = (db.freeAlertSignals || []).filter((r) => r.scoreDate !== date);

    db.freePrecomputedRankings.push(...rankings.map((r) => ({ ...r, scoreDate: date })));
    db.freeTravelScores.push(...scores.map((r) => ({ ...r, scoreDate: date })));
    db.freeAlertSignals.push(...signals.map((r) => ({ ...r, scoreDate: date })));
    return db;
  });
}

