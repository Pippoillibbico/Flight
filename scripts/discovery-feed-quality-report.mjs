import 'dotenv/config';
import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDiscoveryFeedService } from '../server/lib/discovery-feed-service.js';

const ROOT = process.cwd();
const TMP_DIR = resolve(ROOT, '.tmp');
const SQLITE_DB_PATH = resolve(ROOT, 'data', 'app.db');

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function round2(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function parseArg(name, fallback = null) {
  const prefix = `${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return fallback;
}

function parseOriginsArg(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => String(item || '').trim().toUpperCase())
    .filter((item) => /^[A-Z]{3}$/.test(item));
}

function median(values) {
  const list = (values || []).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  if (list.length % 2 === 1) return list[mid];
  return (list[mid - 1] + list[mid]) / 2;
}

function average(values) {
  const list = (values || []).filter((value) => Number.isFinite(value));
  if (!list.length) return 0;
  return list.reduce((sum, value) => sum + value, 0) / list.length;
}

function combineReasons(target, source) {
  const out = target || Object.create(null);
  for (const [key, value] of Object.entries(source || {})) {
    out[String(key)] = Number(out[String(key)] || 0) + Number(value || 0);
  }
  return out;
}

function summarizeTopOffers(payload) {
  const topOffers = Array.isArray(payload?.queries?.top_offers) ? payload.queries.top_offers : [];
  const prices = topOffers.map((item) => toNumber(item?.price, NaN)).filter((value) => Number.isFinite(value) && value > 0);
  const savings = topOffers.map((item) => toNumber(item?.savings_pct, NaN)).filter((value) => Number.isFinite(value));
  const ages = topOffers
    .map((item) => {
      const observed = Date.parse(String(item?.source_observed_at || ''));
      if (!Number.isFinite(observed)) return NaN;
      return (Date.now() - observed) / (60 * 60 * 1000);
    })
    .filter((value) => Number.isFinite(value) && value >= 0);
  const uniqueDestinations = new Set(
    topOffers.map((item) => String(item?.destination_iata || '').trim().toUpperCase()).filter((value) => /^[A-Z]{3}$/.test(value))
  ).size;

  return {
    topDeals: topOffers.length,
    uniqueDestinations,
    avgTopPrice: round2(average(prices)),
    medianTopPrice: round2(median(prices)),
    avgTopSavingsPct: round2(average(savings)),
    avgTopAgeHours: round2(average(ages))
  };
}

async function discoverOrigins({ mode, pool }) {
  if (mode === 'postgres') {
    try {
      const result = await pool.query(`
        SELECT DISTINCT UPPER(COALESCE(r.origin_iata, '')) AS origin_iata
        FROM detected_deals dd
        LEFT JOIN routes r ON r.id = dd.route_id
        WHERE dd.status = 'published'
          AND COALESCE(r.origin_iata, '') <> ''
        ORDER BY 1
        LIMIT 12
      `);
      return (result.rows || [])
        .map((row) => String(row.origin_iata || '').trim().toUpperCase())
        .filter((value) => /^[A-Z]{3}$/.test(value));
    } catch {
      return [];
    }
  }

  const sqlite = await import('node:sqlite');
  const db = new sqlite.DatabaseSync(SQLITE_DB_PATH);
  try {
    try {
      const rows = db
        .prepare(
          `
          SELECT DISTINCT UPPER(COALESCE(r.origin_iata, '')) AS origin_iata
          FROM detected_deals dd
          LEFT JOIN routes r ON r.id = dd.route_id
          WHERE dd.status = 'published'
            AND COALESCE(r.origin_iata, '') <> ''
          ORDER BY 1
          LIMIT 12
        `
        )
        .all();
      return (rows || [])
        .map((row) => String(row.origin_iata || '').trim().toUpperCase())
        .filter((value) => /^[A-Z]{3}$/.test(value));
    } catch {
      return [];
    }
  } finally {
    db.close?.();
  }
}

function summarizeScenarioRuns(runs) {
  const summary = {
    originsProcessed: runs.length,
    skippedOrigins: runs.filter((item) => item.skipped).length,
    totalCandidates: 0,
    totalSourceRows: 0,
    totalValidCandidates: 0,
    totalNearDuplicateFiltered: 0,
    totalDestinationDiversityFiltered: 0,
    avgTopDeals: 0,
    avgUniqueDestinations: 0,
    avgTopPrice: 0,
    avgTopSavingsPct: 0,
    avgTopAgeHours: 0,
    rejectedByReason: Object.create(null)
  };

  const successful = runs.filter((item) => !item.skipped);
  for (const run of successful) {
    summary.totalCandidates += Number(run.meta.total_candidates || 0);
    summary.totalSourceRows += Number(run.meta.source_rows || 0);
    summary.totalValidCandidates += Number(run.meta.valid_candidates || 0);
    summary.totalNearDuplicateFiltered += Number(run.meta.near_duplicate_filtered || 0);
    summary.totalDestinationDiversityFiltered += Number(run.meta.destination_diversity_filtered || 0);
    summary.rejectedByReason = combineReasons(summary.rejectedByReason, run.meta.rejected_by_reason || {});
  }

  summary.avgTopDeals = round2(average(successful.map((item) => Number(item.top.topDeals || 0))));
  summary.avgUniqueDestinations = round2(average(successful.map((item) => Number(item.top.uniqueDestinations || 0))));
  summary.avgTopPrice = round2(average(successful.map((item) => Number(item.top.avgTopPrice || 0))));
  summary.avgTopSavingsPct = round2(average(successful.map((item) => Number(item.top.avgTopSavingsPct || 0))));
  summary.avgTopAgeHours = round2(average(successful.map((item) => Number(item.top.avgTopAgeHours || 0))));
  return summary;
}

function compareAgainstBaseline(baseline, candidate) {
  return {
    totalCandidatesDelta: Number(candidate.totalCandidates || 0) - Number(baseline.totalCandidates || 0),
    avgTopDealsDelta: round2(Number(candidate.avgTopDeals || 0) - Number(baseline.avgTopDeals || 0)),
    avgUniqueDestinationsDelta: round2(Number(candidate.avgUniqueDestinations || 0) - Number(baseline.avgUniqueDestinations || 0)),
    avgTopPriceDelta: round2(Number(candidate.avgTopPrice || 0) - Number(baseline.avgTopPrice || 0)),
    avgTopSavingsPctDelta: round2(Number(candidate.avgTopSavingsPct || 0) - Number(baseline.avgTopSavingsPct || 0)),
    avgTopAgeHoursDelta: round2(Number(candidate.avgTopAgeHours || 0) - Number(baseline.avgTopAgeHours || 0))
  };
}

async function main() {
  const modeArg = String(parseArg('--mode', '') || '')
    .trim()
    .toLowerCase();
  const limit = Math.max(8, Math.min(40, toNumber(parseArg('--limit', '20'), 20)));
  const maxPriceRaw = parseArg('--max-price', '');
  const maxPrice = maxPriceRaw ? Math.max(1, toNumber(maxPriceRaw, 0)) : null;
  const requestedOrigins = parseOriginsArg(parseArg('--origins', ''));

  const mode = modeArg === 'postgres' || modeArg === 'sqlite' ? modeArg : process.env.DATABASE_URL ? 'postgres' : 'sqlite';
  if (mode === 'postgres' && !String(process.env.DATABASE_URL || '').trim()) {
    throw new Error('DATABASE_URL is required when --mode=postgres');
  }
  const sharedPool = mode === 'postgres' ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;

  try {
    const discoveredOrigins = requestedOrigins.length > 0 ? requestedOrigins : await discoverOrigins({ mode, pool: sharedPool });
    const origins = discoveredOrigins.length > 0 ? discoveredOrigins : ['FCO'];

    const scenarios = [
      { id: 'baseline', options: {} },
      {
        id: 'quality_strict',
        options: {
          feedMaxAgeHours: 72,
          feedMaxStops: 2,
          feedMaxDurationMinutes: 1800,
          nearDuplicatePriceDeltaPct: 2,
          feedMaxPerDestination: 2
        }
      },
      {
        id: 'coverage_balanced',
        options: {
          feedMaxAgeHours: 216,
          feedMaxStops: 4,
          nearDuplicatePriceDeltaPct: 5,
          feedMaxPerDestination: 4
        }
      }
    ];

    const scenarioResults = [];
    for (const scenario of scenarios) {
      const service = createDiscoveryFeedService({
        ...(sharedPool ? { pgPool: sharedPool, mode: 'postgres' } : { mode: 'sqlite' }),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        ...scenario.options
      });

      const runs = [];
      for (const origin of origins) {
        const payload = await service.buildDiscoveryFeed({ origin, limit, maxPrice });
        const top = summarizeTopOffers(payload);
        runs.push({
          origin,
          skipped: Boolean(payload?.skipped),
          reason: payload?.reason || null,
          meta: payload?.meta || {},
          top
        });
      }

      scenarioResults.push({
        id: scenario.id,
        options: scenario.options,
        runs,
        summary: summarizeScenarioRuns(runs)
      });
    }

    const baselineSummary = scenarioResults.find((item) => item.id === 'baseline')?.summary || null;
    const comparisons = baselineSummary
      ? scenarioResults
          .filter((item) => item.id !== 'baseline')
          .map((item) => ({
            scenario: item.id,
            deltaVsBaseline: compareAgainstBaseline(baselineSummary, item.summary)
          }))
      : [];

    const report = {
      generatedAt: new Date().toISOString(),
      mode,
      config: {
        limit,
        maxPrice,
        origins
      },
      scenarios: scenarioResults,
      comparisons
    };

    await mkdir(TMP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = resolve(TMP_DIR, `discovery-feed-quality-report-${stamp}.json`);
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(JSON.stringify({ ok: true, reportPath: outPath, mode, origins, scenarioCount: scenarioResults.length }, null, 2));
  } finally {
    if (sharedPool) await sharedPool.end();
  }
}

main().catch((error) => {
  console.error('discovery-feed-quality-report failed:', error?.message || error);
  process.exit(1);
});
