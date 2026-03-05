import { z } from 'zod';
import { getHistoricalPrices, getRouteStats } from './price-history-store.js';
import { logger } from './logger.js';

/**
 * @typedef {Object} BaselineRouteInput
 * @property {string} origin
 * @property {string} destination
 * @property {string} date
 */

const baselineQuerySchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)
});

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const w = pos - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * w;
}

function yearWindow(dateText) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const from = new Date(date);
  from.setUTCDate(from.getUTCDate() - 365);
  return { from: from.toISOString().slice(0, 10), to: dateText };
}

function rollingWindow(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const from = new Date(date);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString().slice(0, 10), to: dateText };
}

function monthPart(dateText) {
  return String(dateText).slice(5, 7);
}

function dayOfWeek(dateText) {
  return new Date(`${dateText}T00:00:00.000Z`).getUTCDay();
}

export async function computeSeasonality(route) {
  const parsed = baselineQuerySchema.parse(route);
  try {
    const year = yearWindow(parsed.date);
    const rows = await getHistoricalPrices({
      origin: parsed.origin,
      destination: parsed.destination,
      dateFrom: year.from,
      dateTo: year.to,
      limit: 5000
    });

    const month = monthPart(parsed.date);
    const dow = dayOfWeek(parsed.date);
    const all = rows.map((r) => Number(r.total_price)).filter((v) => Number.isFinite(v) && v > 0);
    if (!all.length) {
      return {
        seasonalityFactor: 1,
        dayOfWeekFactor: 1,
        sampleSize: 0
      };
    }

    const monthSet = rows
      .filter((r) => String(r.departure_date).slice(5, 7) === month)
      .map((r) => Number(r.total_price))
      .filter((v) => Number.isFinite(v) && v > 0);
    const dowSet = rows
      .filter((r) => new Date(`${String(r.departure_date).slice(0, 10)}T00:00:00.000Z`).getUTCDay() === dow)
      .map((r) => Number(r.total_price))
      .filter((v) => Number.isFinite(v) && v > 0);

    const avgAll = all.reduce((acc, v) => acc + v, 0) / all.length;
    const avgMonth = monthSet.length ? monthSet.reduce((acc, v) => acc + v, 0) / monthSet.length : avgAll;
    const avgDow = dowSet.length ? dowSet.reduce((acc, v) => acc + v, 0) / dowSet.length : avgAll;

    return {
      seasonalityFactor: round2(avgMonth / Math.max(1, avgAll)),
      dayOfWeekFactor: round2(avgDow / Math.max(1, avgAll)),
      sampleSize: all.length
    };
  } catch (error) {
    logger.warn({ err: error, route: parsed }, 'compute_seasonality_failed');
    return { seasonalityFactor: 1, dayOfWeekFactor: 1, sampleSize: 0 };
  }
}

/**
 * Computes deterministic route baseline using historical median, rolling average, and seasonality multipliers.
 * @param {BaselineRouteInput} route
 */
export async function computeBaseline(route) {
  const parsed = baselineQuerySchema.parse(route);
  try {
    const year = yearWindow(parsed.date);
    const rolling30 = rollingWindow(parsed.date, 30);
    const [yearStats, rollingRows, seasonal] = await Promise.all([
      getRouteStats({
        origin: parsed.origin,
        destination: parsed.destination,
        dateFrom: year.from,
        dateTo: year.to
      }),
      getHistoricalPrices({
        origin: parsed.origin,
        destination: parsed.destination,
        dateFrom: rolling30.from,
        dateTo: rolling30.to,
        limit: 5000
      }),
      computeSeasonality(parsed)
    ]);

    const rollingPrices = rollingRows.map((r) => Number(r.total_price)).filter((v) => Number.isFinite(v) && v > 0);
    const rollingAvg = rollingPrices.length
      ? rollingPrices.reduce((acc, v) => acc + v, 0) / rollingPrices.length
      : Number(yearStats?.avg || 0);
    const median = Number(yearStats?.median || 0);
    const baselineRaw = median * 0.45 + rollingAvg * 0.35 + median * seasonal.seasonalityFactor * 0.12 + median * seasonal.dayOfWeekFactor * 0.08;
    const baseline = round2(Math.max(1, baselineRaw));

    return {
      baseline,
      medianPrice: round2(median || 0),
      rolling30Avg: round2(rollingAvg || 0),
      seasonalityFactor: seasonal.seasonalityFactor,
      dayOfWeekFactor: seasonal.dayOfWeekFactor,
      p10: Number(yearStats?.p10 || 0),
      p25: Number(yearStats?.p25 || 0),
      p75: Number(yearStats?.p75 || 0),
      p90: Number(yearStats?.p90 || 0),
      observationCount: Number(yearStats?.count || 0)
    };
  } catch (error) {
    logger.error({ err: error, route: parsed }, 'compute_baseline_failed');
    throw error;
  }
}

/**
 * Computes deviation of current price from baseline.
 * @param {number} price
 * @param {number} baseline
 */
export function computeDeviation(price, baseline) {
  const value = Number(price);
  const base = Number(baseline);
  if (!Number.isFinite(value) || !Number.isFinite(base) || base <= 0) {
    return { absolute: 0, percent: 0, direction: 'flat' };
  }
  const absolute = round2(value - base);
  const percent = round2((absolute / base) * 100);
  const direction = absolute < 0 ? 'below' : absolute > 0 ? 'above' : 'flat';
  return { absolute, percent, direction };
}

/**
 * Robust anomaly detector using MAD-based robust z-score.
 * @param {number[]} pricesAsc
 * @param {number} value
 */
export function robustAnomalySignal(pricesAsc, value) {
  const list = [...pricesAsc].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (list.length < 8) return { isAnomaly: false, robustZ: 0, mad: 0 };
  const med = percentile(list, 0.5);
  const abs = list.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = percentile(abs, 0.5);
  if (mad === 0) return { isAnomaly: false, robustZ: 0, mad: 0 };
  const robustZ = 0.6745 * ((Number(value) - med) / mad);
  return {
    isAnomaly: robustZ < -2.7,
    robustZ: round2(robustZ),
    mad: round2(mad)
  };
}
