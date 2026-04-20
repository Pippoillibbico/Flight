import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { logger as rootLogger } from './logger.js';
import { getDetectedDealsRuntimeConfig } from './detected-deals-config.js';
import {
  DETECTED_DEALS_POSTGRES_REFS_SQL,
  DETECTED_DEALS_POSTGRES_SCHEMA_SQL,
  DETECTED_DEALS_POSTGRES_USER_EVENTS_SQL,
  DETECTED_DEALS_SQLITE_DEAL_SCORE_INDEX_SQL,
  DETECTED_DEALS_SQLITE_DEAL_SCORE_MIGRATION_SQL,
  DETECTED_DEALS_SQLITE_SCHEMA_SQL
} from './detected-deals-schema.js';
import {
  clamp,
  evaluateCandidate,
  hasSqliteTable,
  normalizeRouteId,
  parseJsonObject,
  round2,
  toNumber
} from './detected-deals-helpers.js';

const SQLITE_DB_PATH = fileURLToPath(new URL('../../data/app.db', import.meta.url));

export function createDetectedDealsEngine(options = {}) {
  const forcedMode = String(options.mode || '').trim().toLowerCase();
  let mode = forcedMode === 'postgres' || forcedMode === 'sqlite' ? forcedMode : process.env.DATABASE_URL ? 'postgres' : 'sqlite';
  const logger = options.logger || rootLogger;

  let pgPool = options.pgPool || null;
  let sqliteDb = options.sqliteDb || null;
  let initialized = false;
  let schemaReady = true;
  let schemaReason = null;
  let pgQuoteContextColumns = null;
  let sqliteQuoteContextColumns = null;
  let pgHasTravelOpportunitiesTable = null;
  let sqliteHasTravelOpportunitiesTable = null;

  async function ensurePostgresSchema() {
    if (!pgPool) {
      pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    }

    const refs = await pgPool.query(DETECTED_DEALS_POSTGRES_REFS_SQL);
    const row = refs.rows[0] || {};
    if (!row.routes_ref || !row.flight_quotes_ref || !row.route_price_stats_ref) {
      schemaReady = false;
      schemaReason = !row.flight_quotes_ref ? 'flight_quotes_missing' : !row.route_price_stats_ref ? 'route_price_stats_missing' : 'routes_missing';
      return;
    }

    await pgPool.query(DETECTED_DEALS_POSTGRES_USER_EVENTS_SQL);
    await pgPool.query(DETECTED_DEALS_POSTGRES_SCHEMA_SQL);
  }

  async function ensureSqliteSchema() {
    if (!sqliteDb) {
      await mkdir(dirname(SQLITE_DB_PATH), { recursive: true });
      const sqlite = await import('node:sqlite');
      sqliteDb = new sqlite.DatabaseSync(SQLITE_DB_PATH);
    }

    sqliteDb.exec(DETECTED_DEALS_SQLITE_SCHEMA_SQL);
    try {
      sqliteDb.exec(DETECTED_DEALS_SQLITE_DEAL_SCORE_MIGRATION_SQL);
    } catch {}
    try {
      sqliteDb.exec(DETECTED_DEALS_SQLITE_DEAL_SCORE_INDEX_SQL);
    } catch {}
  }

  async function ensureInitialized() {
    if (initialized) return;
    mode = forcedMode === 'postgres' || forcedMode === 'sqlite' ? forcedMode : process.env.DATABASE_URL ? 'postgres' : 'sqlite';
    if (mode === 'postgres') await ensurePostgresSchema();
    else await ensureSqliteSchema();
    initialized = true;
  }

  async function hasSourceTables() {
    if (mode === 'postgres') {
      const refs = await pgPool.query(`
        SELECT
          to_regclass('public.flight_quotes') AS flight_quotes_ref,
          to_regclass('public.route_price_stats') AS route_price_stats_ref
      `);
      const row = refs.rows[0] || {};
      if (!row.flight_quotes_ref) return { ok: false, reason: 'flight_quotes_missing' };
      if (!row.route_price_stats_ref) return { ok: false, reason: 'route_price_stats_missing' };
      return { ok: true, reason: null };
    }
    if (!hasSqliteTable(sqliteDb, 'flight_quotes')) return { ok: false, reason: 'flight_quotes_missing' };
    if (!hasSqliteTable(sqliteDb, 'route_price_stats')) return { ok: false, reason: 'route_price_stats_missing' };
    return { ok: true, reason: null };
  }

  async function getPostgresQuoteContextColumns() {
    if (pgQuoteContextColumns) return pgQuoteContextColumns;
    const result = await pgPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'flight_quotes'
        AND column_name IN ('source', 'metadata')
    `);
    const names = new Set((result.rows || []).map((row) => String(row.column_name || '').trim().toLowerCase()));
    pgQuoteContextColumns = {
      source: names.has('source'),
      metadata: names.has('metadata')
    };
    return pgQuoteContextColumns;
  }

  function getSqliteQuoteContextColumns() {
    if (sqliteQuoteContextColumns) return sqliteQuoteContextColumns;
    const columns = sqliteDb.prepare(`PRAGMA table_info(flight_quotes)`).all();
    const names = new Set((columns || []).map((col) => String(col.name || '').trim().toLowerCase()));
    sqliteQuoteContextColumns = {
      source: names.has('source'),
      metadata: names.has('metadata')
    };
    return sqliteQuoteContextColumns;
  }

  async function loadQuoteContextMap(candidates) {
    const ids = Array.from(
      new Set(candidates.map((row) => Number(row.flight_quote_id)).filter((id) => Number.isInteger(id) && id > 0))
    );
    const map = new Map();
    if (ids.length === 0) return map;

    if (mode === 'postgres') {
      const columns = await getPostgresQuoteContextColumns();
      if (!columns.source && !columns.metadata) return map;
      const sourceExpr = columns.source ? 'source' : 'NULL::text AS source';
      const metadataExpr = columns.metadata ? 'metadata' : `'{}'::jsonb AS metadata`;
      const result = await pgPool.query(
        `
          SELECT id, ${sourceExpr}, ${metadataExpr}
          FROM flight_quotes
          WHERE id = ANY($1::bigint[])
        `,
        [ids]
      );
      for (const row of result.rows || []) {
        map.set(Number(row.id), {
          source: row.source || null,
          metadata: row.metadata ?? null
        });
      }
      return map;
    }

    const columns = getSqliteQuoteContextColumns();
    if (!columns.source && !columns.metadata) return map;
    const placeholders = ids.map(() => '?').join(', ');
    const sourceExpr = columns.source ? 'source' : 'NULL AS source';
    const metadataExpr = columns.metadata ? 'metadata' : 'NULL AS metadata';
    const rows = sqliteDb
      .prepare(
        `
          SELECT id, ${sourceExpr}, ${metadataExpr}
          FROM flight_quotes
          WHERE id IN (${placeholders})
        `
      )
      .all(...ids);
    for (const row of rows || []) {
      map.set(Number(row.id), {
        source: row.source || null,
        metadata: row.metadata ?? null
      });
    }
    return map;
  }

  async function hasTravelOpportunitiesTable() {
    if (mode === 'postgres') {
      if (pgHasTravelOpportunitiesTable != null) return pgHasTravelOpportunitiesTable;
      const result = await pgPool.query(`SELECT to_regclass('public.travel_opportunities') AS ref`);
      pgHasTravelOpportunitiesTable = Boolean(result.rows?.[0]?.ref);
      return pgHasTravelOpportunitiesTable;
    }
    if (sqliteHasTravelOpportunitiesTable != null) return sqliteHasTravelOpportunitiesTable;
    sqliteHasTravelOpportunitiesTable = hasSqliteTable(sqliteDb, 'travel_opportunities');
    return sqliteHasTravelOpportunitiesTable;
  }

  async function enrichBootstrapQuoteContextFromOpportunities(quoteContext) {
    if (!(quoteContext instanceof Map) || quoteContext.size === 0) return;

    const opportunityIds = new Set();
    for (const context of quoteContext.values()) {
      const source = String(context?.source || '').trim().toLowerCase();
      if (source !== 'opportunity_bootstrap') continue;
      const metadata = parseJsonObject(context?.metadata, {});
      const id = String(metadata?.opportunityId || '').trim();
      if (!id) continue;
      opportunityIds.add(id);
    }

    if (opportunityIds.size === 0) return;
    if (!(await hasTravelOpportunitiesTable())) return;

    const idList = Array.from(opportunityIds);
    const opportunityMap = new Map();
    if (mode === 'postgres') {
      const result = await pgPool.query(
        `
          SELECT
            id::text AS id,
            price,
            baseline_price,
            savings_percent_if_available,
            final_score,
            opportunity_level
          FROM travel_opportunities
          WHERE id = ANY($1::text[])
        `,
        [idList]
      );
      for (const row of result.rows || []) {
        opportunityMap.set(String(row.id), row);
      }
    } else {
      const placeholders = idList.map(() => '?').join(', ');
      const rows = sqliteDb
        .prepare(
          `
            SELECT
              id,
              price,
              baseline_price,
              savings_percent_if_available,
              final_score,
              opportunity_level
            FROM travel_opportunities
            WHERE id IN (${placeholders})
          `
        )
        .all(...idList);
      for (const row of rows || []) {
        opportunityMap.set(String(row.id), row);
      }
    }

    if (opportunityMap.size === 0) return;

    for (const context of quoteContext.values()) {
      const source = String(context?.source || '').trim().toLowerCase();
      if (source !== 'opportunity_bootstrap') continue;

      const metadata = parseJsonObject(context?.metadata, {});
      const opportunityId = String(metadata?.opportunityId || '').trim();
      if (!opportunityId) continue;
      const opp = opportunityMap.get(opportunityId);
      if (!opp) continue;

      const merged = { ...metadata, bootstrap: true };
      const baselineRaw = toNumber(opp.baseline_price, NaN);
      const priceRaw = toNumber(opp.price, NaN);
      const savingsPctRaw = toNumber(opp.savings_percent_if_available, NaN);
      const derivedSavingsPct =
        Number.isFinite(savingsPctRaw)
          ? savingsPctRaw
          : Number.isFinite(baselineRaw) && baselineRaw > 0 && Number.isFinite(priceRaw)
            ? ((baselineRaw - priceRaw) / baselineRaw) * 100
            : NaN;
      const derivedSavingsAmount =
        Number.isFinite(baselineRaw) && Number.isFinite(priceRaw) ? Math.max(0, baselineRaw - priceRaw) : NaN;
      const finalScoreRaw = toNumber(opp.final_score, NaN);
      const opportunityLevel = String(opp.opportunity_level || '').trim();

      if (!Number.isFinite(toNumber(merged.baselinePrice, NaN)) && Number.isFinite(baselineRaw) && baselineRaw > 0) {
        merged.baselinePrice = round2(baselineRaw);
      }
      if (!Number.isFinite(toNumber(merged.savingsPct, NaN)) && Number.isFinite(derivedSavingsPct)) {
        merged.savingsPct = round2(Math.max(0, derivedSavingsPct));
      }
      if (!Number.isFinite(toNumber(merged.savingsAmount, NaN)) && Number.isFinite(derivedSavingsAmount)) {
        merged.savingsAmount = round2(derivedSavingsAmount);
      }
      if (!Number.isFinite(toNumber(merged.finalScore, NaN)) && Number.isFinite(finalScoreRaw)) {
        merged.finalScore = round2(finalScoreRaw);
      }
      if (!String(merged.opportunityLevel || '').trim() && opportunityLevel) {
        merged.opportunityLevel = opportunityLevel;
      }

      context.metadata = merged;
    }
  }

  async function loadCandidatesPostgres({ routeId, lookbackHours, signalLookbackDays, maxCandidates }) {
    const routeWhere = routeId != null ? 'AND fq.route_id = $4' : '';
    const params = [lookbackHours, maxCandidates, signalLookbackDays];
    if (routeId != null) params.push(routeId);

    const sql = `
      WITH route_popularity AS (
        SELECT fq.route_id, COUNT(*)::int AS observations_30d
        FROM flight_quotes fq
        WHERE fq.observed_at >= NOW() - ($3 * INTERVAL '1 day')
        GROUP BY fq.route_id
      ),
      route_signals AS (
        SELECT
          COALESCE(
            ue.route_id,
            CASE
              WHEN (ue.payload ->> 'route_id') ~ '^[0-9]+$' THEN NULLIF((ue.payload ->> 'route_id')::bigint, 0)
              ELSE NULL
            END
          ) AS route_id,
          SUM(
            (
              CASE
                WHEN LOWER(ue.event_type) LIKE '%book%' OR LOWER(ue.event_type) LIKE '%purchase%' OR LOWER(ue.event_type) LIKE '%checkout%' THEN 6
                WHEN LOWER(ue.event_type) LIKE '%save%' OR LOWER(ue.event_type) LIKE '%watch%' OR LOWER(ue.event_type) LIKE '%alert%' THEN 3
                WHEN LOWER(ue.event_type) LIKE '%click%' OR LOWER(ue.event_type) LIKE '%open%' OR LOWER(ue.event_type) LIKE '%view%' THEN 1.5
                ELSE 1
              END
            ) * (
              CASE
                WHEN ue.event_ts >= NOW() - INTERVAL '24 hours' THEN 1
                WHEN ue.event_ts >= NOW() - INTERVAL '72 hours' THEN 0.75
                WHEN ue.event_ts >= NOW() - INTERVAL '7 days' THEN 0.5
                ELSE 0.25
              END
            )
          )::numeric(12,2) AS weighted_signals
        FROM user_events ue
        WHERE ue.event_ts >= NOW() - ($3 * INTERVAL '1 day')
        GROUP BY 1
      )
      SELECT
        fq.id AS flight_quote_id,
        fq.route_id,
        fq.departure_date,
        fq.return_date,
        fq.trip_type,
        fq.cabin_class,
        fq.currency,
        fq.total_price,
        fq.stops,
        fq.duration_minutes,
        fq.observed_at,
        rps.avg_price,
        COALESCE(rps.min_price, rps.avg_price) AS min_price,
        COALESCE(rps.max_price, rps.avg_price) AS max_price,
        COALESCE(rps.avg_price_7d, rps.avg_price) AS avg_price_7d,
        COALESCE(rps.avg_price_30d, rps.avg_price) AS avg_price_30d,
        rps.quotes_count,
        rps.confidence_level,
        COALESCE(rp.observations_30d, 0)::numeric AS route_popularity_30d,
        COALESCE(rs.weighted_signals, 0)::numeric AS user_signals_30d,
        prev.prev_price,
        prev.prev_observed_at
      FROM flight_quotes fq
      JOIN route_price_stats rps
        ON rps.route_id = fq.route_id
       AND rps.departure_month = date_trunc('month', fq.departure_date)::date
       AND rps.trip_type = fq.trip_type
       AND rps.cabin_class = fq.cabin_class
       AND rps.currency = fq.currency
      LEFT JOIN route_popularity rp ON rp.route_id = fq.route_id
      LEFT JOIN route_signals rs ON rs.route_id = fq.route_id
      LEFT JOIN LATERAL (
        SELECT
          fq_prev.total_price AS prev_price,
          fq_prev.observed_at AS prev_observed_at
        FROM flight_quotes fq_prev
        WHERE fq_prev.route_id = fq.route_id
          AND fq_prev.trip_type = fq.trip_type
          AND fq_prev.cabin_class = fq.cabin_class
          AND fq_prev.currency = fq.currency
          AND fq_prev.observed_at < fq.observed_at
        ORDER BY fq_prev.observed_at DESC
        LIMIT 1
      ) prev ON TRUE
      WHERE fq.observed_at >= NOW() - ($1 * INTERVAL '1 hour')
        AND fq.departure_date >= CURRENT_DATE
        AND fq.total_price > 0
        AND (fq.is_bookable IS NULL OR fq.is_bookable = true)
        AND (fq.stops IS NULL OR fq.stops <= 3)
        AND (fq.duration_minutes IS NULL OR fq.duration_minutes <= 0 OR fq.duration_minutes BETWEEN 30 AND 2160)
        ${routeWhere}
      ORDER BY fq.observed_at DESC
      LIMIT $2
    `;

    const result = await pgPool.query(sql, params);
    return result.rows || [];
  }

  function loadCandidatesSqlite({ routeId, lookbackHours, signalLookbackDays, maxCandidates }) {
    const routeWhere = routeId != null ? 'AND fq.route_id = ?' : '';
    const params = [signalLookbackDays, signalLookbackDays, lookbackHours];
    if (routeId != null) params.push(routeId);
    params.push(maxCandidates);

    const sql = `
      WITH route_popularity AS (
        SELECT fq.route_id, COUNT(*) AS observations_30d
        FROM flight_quotes fq
        WHERE datetime(fq.observed_at) >= datetime('now', '-' || ? || ' day')
        GROUP BY fq.route_id
      ),
      route_signals AS (
        SELECT
          ue.route_id AS route_id,
          SUM(
            (
              CASE
                WHEN LOWER(ue.event_type) LIKE '%book%' OR LOWER(ue.event_type) LIKE '%purchase%' OR LOWER(ue.event_type) LIKE '%checkout%' THEN 6
                WHEN LOWER(ue.event_type) LIKE '%save%' OR LOWER(ue.event_type) LIKE '%watch%' OR LOWER(ue.event_type) LIKE '%alert%' THEN 3
                WHEN LOWER(ue.event_type) LIKE '%click%' OR LOWER(ue.event_type) LIKE '%open%' OR LOWER(ue.event_type) LIKE '%view%' THEN 1.5
                ELSE 1
              END
            ) * (
              CASE
                WHEN datetime(ue.event_ts) >= datetime('now', '-24 hour') THEN 1
                WHEN datetime(ue.event_ts) >= datetime('now', '-72 hour') THEN 0.75
                WHEN datetime(ue.event_ts) >= datetime('now', '-7 day') THEN 0.5
                ELSE 0.25
              END
            )
          ) AS weighted_signals
        FROM user_events ue
        WHERE ue.route_id IS NOT NULL
          AND datetime(ue.event_ts) >= datetime('now', '-' || ? || ' day')
        GROUP BY ue.route_id
      )
      SELECT
        fq.id AS flight_quote_id,
        fq.route_id,
        fq.departure_date,
        fq.return_date,
        fq.trip_type,
        fq.cabin_class,
        fq.currency,
        fq.total_price,
        fq.stops,
        fq.duration_minutes,
        fq.observed_at,
        rps.avg_price,
        COALESCE(rps.min_price, rps.avg_price) AS min_price,
        COALESCE(rps.max_price, rps.avg_price) AS max_price,
        COALESCE(rps.avg_price_7d, rps.avg_price) AS avg_price_7d,
        COALESCE(rps.avg_price_30d, rps.avg_price) AS avg_price_30d,
        rps.quotes_count,
        rps.confidence_level,
        COALESCE(rp.observations_30d, 0) AS route_popularity_30d,
        COALESCE(rs.weighted_signals, 0) AS user_signals_30d,
        (
          SELECT fq_prev.total_price
          FROM flight_quotes fq_prev
          WHERE fq_prev.route_id = fq.route_id
            AND fq_prev.trip_type = fq.trip_type
            AND fq_prev.cabin_class = fq.cabin_class
            AND fq_prev.currency = fq.currency
            AND datetime(fq_prev.observed_at) < datetime(fq.observed_at)
          ORDER BY datetime(fq_prev.observed_at) DESC
          LIMIT 1
        ) AS prev_price,
        (
          SELECT fq_prev.observed_at
          FROM flight_quotes fq_prev
          WHERE fq_prev.route_id = fq.route_id
            AND fq_prev.trip_type = fq.trip_type
            AND fq_prev.cabin_class = fq.cabin_class
            AND fq_prev.currency = fq.currency
            AND datetime(fq_prev.observed_at) < datetime(fq.observed_at)
          ORDER BY datetime(fq_prev.observed_at) DESC
          LIMIT 1
        ) AS prev_observed_at
      FROM flight_quotes fq
      JOIN route_price_stats rps
        ON rps.route_id = fq.route_id
       AND rps.departure_month = substr(fq.departure_date, 1, 7) || '-01'
       AND rps.trip_type = fq.trip_type
       AND rps.cabin_class = fq.cabin_class
       AND rps.currency = fq.currency
      LEFT JOIN route_popularity rp ON rp.route_id = fq.route_id
      LEFT JOIN route_signals rs ON rs.route_id = fq.route_id
      WHERE datetime(fq.observed_at) >= datetime('now', '-' || ? || ' hour')
        AND date(fq.departure_date) >= date('now')
        AND fq.total_price > 0
        AND (fq.is_bookable IS NULL OR fq.is_bookable = 1)
        AND (fq.stops IS NULL OR fq.stops <= 3)
        AND (fq.duration_minutes IS NULL OR fq.duration_minutes <= 0 OR fq.duration_minutes BETWEEN 30 AND 2160)
        ${routeWhere}
      ORDER BY datetime(fq.observed_at) DESC
      LIMIT ?
    `;

    return sqliteDb.prepare(sql).all(...params);
  }

  async function upsertDealsPostgres(deals) {
    const upsertSql = `
      INSERT INTO detected_deals (
        deal_key, flight_quote_id, route_id, deal_type, raw_score, final_score, deal_score, opportunity_level,
        price, baseline_price, savings_amount, savings_pct, status, rejection_reason, score_breakdown,
        published_at, expires_at, source_observed_at, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15::jsonb,
        $16::timestamptz, $17::timestamptz, $18::timestamptz, NOW(), NOW()
      )
      ON CONFLICT (deal_key)
      DO UPDATE SET
        flight_quote_id = EXCLUDED.flight_quote_id,
        route_id = EXCLUDED.route_id,
        deal_type = EXCLUDED.deal_type,
        raw_score = EXCLUDED.raw_score,
        final_score = EXCLUDED.final_score,
        deal_score = EXCLUDED.deal_score,
        opportunity_level = EXCLUDED.opportunity_level,
        price = EXCLUDED.price,
        baseline_price = EXCLUDED.baseline_price,
        savings_amount = EXCLUDED.savings_amount,
        savings_pct = EXCLUDED.savings_pct,
        status = EXCLUDED.status,
        rejection_reason = EXCLUDED.rejection_reason,
        score_breakdown = EXCLUDED.score_breakdown,
        published_at = EXCLUDED.published_at,
        expires_at = EXCLUDED.expires_at,
        source_observed_at = EXCLUDED.source_observed_at,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;

    let insertedDeals = 0;
    let updatedDeals = 0;
    for (const deal of deals) {
      const result = await pgPool.query(upsertSql, [
        deal.dealKey,
        deal.flightQuoteId,
        deal.routeId,
        deal.dealType,
        deal.rawScore,
        deal.finalScore,
        deal.dealScore,
        deal.opportunityLevel,
        deal.price,
        deal.baselinePrice,
        deal.savingsAmount,
        deal.savingsPct,
        deal.status,
        deal.rejectionReason || null,
        JSON.stringify(deal.scoreBreakdown || {}),
        deal.publishedAt || null,
        deal.expiresAt || null,
        deal.sourceObservedAt
      ]);
      if (result.rows[0]?.inserted) insertedDeals += 1;
      else updatedDeals += 1;
    }
    return { insertedDeals, updatedDeals };
  }

  function upsertDealsSqlite(deals) {
    const existingStmt = sqliteDb.prepare(`SELECT id FROM detected_deals WHERE deal_key = ? LIMIT 1`);
    const upsertStmt = sqliteDb.prepare(`
      INSERT INTO detected_deals (
        deal_key, flight_quote_id, route_id, deal_type, raw_score, final_score, deal_score, opportunity_level,
        price, baseline_price, savings_amount, savings_pct, status, rejection_reason, score_breakdown,
        published_at, expires_at, source_observed_at, created_at, updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, datetime('now'), datetime('now')
      )
      ON CONFLICT(deal_key) DO UPDATE SET
        flight_quote_id = excluded.flight_quote_id,
        route_id = excluded.route_id,
        deal_type = excluded.deal_type,
        raw_score = excluded.raw_score,
        final_score = excluded.final_score,
        deal_score = excluded.deal_score,
        opportunity_level = excluded.opportunity_level,
        price = excluded.price,
        baseline_price = excluded.baseline_price,
        savings_amount = excluded.savings_amount,
        savings_pct = excluded.savings_pct,
        status = excluded.status,
        rejection_reason = excluded.rejection_reason,
        score_breakdown = excluded.score_breakdown,
        published_at = excluded.published_at,
        expires_at = excluded.expires_at,
        source_observed_at = excluded.source_observed_at,
        updated_at = datetime('now')
    `);

    let insertedDeals = 0;
    let updatedDeals = 0;
    for (const deal of deals) {
      const existing = existingStmt.get(deal.dealKey);
      upsertStmt.run(
        deal.dealKey,
        deal.flightQuoteId,
        deal.routeId,
        deal.dealType,
        deal.rawScore,
        deal.finalScore,
        deal.dealScore,
        deal.opportunityLevel,
        deal.price,
        deal.baselinePrice,
        deal.savingsAmount,
        deal.savingsPct,
        deal.status,
        deal.rejectionReason || null,
        JSON.stringify(deal.scoreBreakdown || {}),
        deal.publishedAt || null,
        deal.expiresAt || null,
        deal.sourceObservedAt
      );
      if (existing?.id) updatedDeals += 1;
      else insertedDeals += 1;
    }
    return { insertedDeals, updatedDeals };
  }

  async function expireStaleDeals({ lookbackHours, routeId }) {
    if (mode === 'postgres') {
      const params = [lookbackHours];
      const routeClause = routeId != null ? 'AND route_id = $2' : '';
      if (routeId != null) params.push(routeId);
      const sql = `
        UPDATE detected_deals
        SET status = 'expired', updated_at = NOW()
        WHERE status IN ('candidate', 'published')
          AND (
            (expires_at IS NOT NULL AND expires_at < NOW())
            OR source_observed_at < NOW() - ($1 * INTERVAL '1 hour')
          )
          ${routeClause}
      `;
      const result = await pgPool.query(sql, params);
      return Number(result.rowCount || 0);
    }

    const routeClause = routeId != null ? 'AND route_id = ?' : '';
    const params = [lookbackHours];
    if (routeId != null) params.push(routeId);
    const result = sqliteDb
      .prepare(`
        UPDATE detected_deals
        SET status = 'expired', updated_at = datetime('now')
        WHERE status IN ('candidate', 'published')
          AND (
            (expires_at IS NOT NULL AND datetime(expires_at) < datetime('now'))
            OR datetime(source_observed_at) < datetime('now', '-' || ? || ' hour')
          )
          ${routeClause}
      `)
      .run(...params);
    return Number(result?.changes || 0);
  }

  async function cleanupExpiredDeals({ retentionDays, routeId }) {
    if (mode === 'postgres') {
      const params = [retentionDays];
      const routeClause = routeId != null ? 'AND route_id = $2' : '';
      if (routeId != null) params.push(routeId);
      const sql = `
        DELETE FROM detected_deals
        WHERE status = 'expired'
          AND (
            source_observed_at < NOW() - ($1 * INTERVAL '1 day')
            OR (expires_at IS NOT NULL AND expires_at < NOW() - ($1 * INTERVAL '1 day'))
          )
          ${routeClause}
      `;
      const result = await pgPool.query(sql, params);
      return Number(result.rowCount || 0);
    }

    const routeClause = routeId != null ? 'AND route_id = ?' : '';
    const result = sqliteDb
      .prepare(
        `DELETE FROM detected_deals
         WHERE status = 'expired'
           AND (
             datetime(source_observed_at) < datetime('now', '-' || ? || ' day')
             OR (expires_at IS NOT NULL AND datetime(expires_at) < datetime('now', '-' || ? || ' day'))
           )
           ${routeClause}`
      )
      .run(...(routeId != null ? [retentionDays, retentionDays, routeId] : [retentionDays, retentionDays]));
    return Number(result?.changes || 0);
  }

  async function detectDeals({ routeId = null, ...runtimeOptions } = {}) {
    await ensureInitialized();
    const normalizedRouteId = normalizeRouteId(routeId);
    const config = getDetectedDealsRuntimeConfig(runtimeOptions, options);
    const startedAt = Date.now();

    if (!schemaReady) {
      return {
        skipped: true,
        reason: schemaReason || 'schema_not_ready',
        processedQuotes: 0,
        validDeals: 0,
        selectedDeals: 0,
        publishedDeals: 0,
        insertedDeals: 0,
        updatedDeals: 0,
        expiredDeals: 0,
        deletedExpiredDeals: 0,
        rejectedDeals: 0,
        mode
      };
    }

    const sourceStatus = await hasSourceTables();
    if (!sourceStatus.ok) {
      return {
        skipped: true,
        reason: sourceStatus.reason,
        processedQuotes: 0,
        validDeals: 0,
        selectedDeals: 0,
        publishedDeals: 0,
        insertedDeals: 0,
        updatedDeals: 0,
        expiredDeals: 0,
        deletedExpiredDeals: 0,
        rejectedDeals: 0,
        mode
      };
    }

    const candidates =
      mode === 'postgres'
        ? await loadCandidatesPostgres({
            routeId: normalizedRouteId,
            lookbackHours: config.lookbackHours,
            signalLookbackDays: config.signalLookbackDays,
            maxCandidates: config.maxCandidates
          })
        : loadCandidatesSqlite({
            routeId: normalizedRouteId,
            lookbackHours: config.lookbackHours,
            signalLookbackDays: config.signalLookbackDays,
            maxCandidates: config.maxCandidates
          });
    const quoteContext = await loadQuoteContextMap(candidates);
    await enrichBootstrapQuoteContextFromOpportunities(quoteContext);
    if (quoteContext.size > 0) {
      for (const row of candidates) {
        const context = quoteContext.get(Number(row.flight_quote_id));
        if (!context) continue;
        row.quote_source = context.source;
        row.quote_metadata = context.metadata;
      }
    }

    const nowTs = Date.now();
    const valid = [];
    let rejectedDeals = 0;
    for (const row of candidates) {
      const evaluation = evaluateCandidate(row, { nowTs, ...config });
      if (!evaluation.valid) {
        rejectedDeals += 1;
        continue;
      }
      valid.push(evaluation.deal);
    }

    valid.sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return new Date(b.sourceObservedAt).getTime() - new Date(a.sourceObservedAt).getTime();
    });

    const selected = valid.slice(0, config.maxPublishedPerRun);
    let publishedDeals = selected.filter((item) => item.status === 'published').length;
    let fallbackPromotedDeals = 0;
    let publishFallbackThreshold = null;

    if (selected.length > 0 && publishedDeals === 0 && config.publishFallbackEnabled) {
      publishFallbackThreshold = Math.max(config.minScore, config.publishScore - config.publishFallbackDelta);
      const maxPromotions = Math.min(config.publishFallbackMaxPerRun, selected.length);
      const publishedAt = new Date(nowTs).toISOString();

      for (const deal of selected) {
        if (fallbackPromotedDeals >= maxPromotions) break;
        if (deal.status !== 'candidate') continue;
        if (toNumber(deal.finalScore, 0) < publishFallbackThreshold) continue;

        deal.status = 'published';
        deal.publishedAt = publishedAt;
        const breakdown = parseJsonObject(deal.scoreBreakdown, {});
        const gates = parseJsonObject(breakdown.gates, {});
        const publish = parseJsonObject(breakdown.publish, {});
        deal.scoreBreakdown = {
          ...breakdown,
          gates: {
            ...gates,
            publish_fallback: true
          },
          publish: {
            ...publish,
            mode: 'fallback',
            threshold: publishFallbackThreshold,
            target_publish_score: config.publishScore
          }
        };
        fallbackPromotedDeals += 1;
      }

      publishedDeals = selected.filter((item) => item.status === 'published').length;
    }

    let insertedDeals = 0;
    let updatedDeals = 0;
    if (selected.length > 0) {
      const upsertResult = mode === 'postgres' ? await upsertDealsPostgres(selected) : upsertDealsSqlite(selected);
      insertedDeals = Number(upsertResult.insertedDeals || 0);
      updatedDeals = Number(upsertResult.updatedDeals || 0);
    }

    const expiredDeals = await expireStaleDeals({ lookbackHours: config.lookbackHours, routeId: normalizedRouteId });
    const deletedExpiredDeals = await cleanupExpiredDeals({ retentionDays: config.retentionDays, routeId: normalizedRouteId });

    const result = {
      skipped: false,
      reason: null,
      processedQuotes: candidates.length,
      validDeals: valid.length,
      selectedDeals: selected.length,
      publishedDeals,
      fallbackPromotedDeals,
      publishFallbackThreshold,
      insertedDeals,
      updatedDeals,
      expiredDeals,
      deletedExpiredDeals,
      rejectedDeals,
      mode
    };

    logger.info(
      {
        routeId: normalizedRouteId,
        durationMs: Date.now() - startedAt,
        config: {
          lookbackHours: config.lookbackHours,
          signalLookbackDays: config.signalLookbackDays,
          maxCandidates: config.maxCandidates,
          maxPublishedPerRun: config.maxPublishedPerRun,
          minDiscountPct: config.minDiscountPct,
          nearMinRatio: config.nearMinRatio,
          rapidDropRatio: config.rapidDropRatio,
          rapidDropMinPct: config.rapidDropMinPct,
          minScore: config.minScore,
          publishScore: config.publishScore,
          publishFallbackEnabled: config.publishFallbackEnabled,
          publishFallbackDelta: config.publishFallbackDelta,
          publishFallbackMaxPerRun: config.publishFallbackMaxPerRun,
          retentionDays: config.retentionDays
        },
        ...result
      },
      'detected_deals_engine_completed'
    );

    return result;
  }

  return {
    detectDeals,
    getMode: () => mode
  };
}

let singleton = null;

export function getDetectedDealsEngine() {
  if (!singleton) singleton = createDetectedDealsEngine();
  return singleton;
}

export async function detectAndStoreDeals(options = {}) {
  return getDetectedDealsEngine().detectDeals(options);
}
