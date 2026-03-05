import { z } from 'zod';
import { computeBaseline, computeDeviation, robustAnomalySignal } from './baseline-price-engine.js';
import { detectPriceAnomaly } from './anomaly-detector.js';
import { buildSeasonalContext } from './seasonal-context-engine.js';
import { predictPriceDirection } from './price-predictor.js';
import { getHistoricalPrices } from './price-history-store.js';
import { inferDealType, rankDeal, rankDealV2, rarityFromSample } from './deal-ranking-engine.js';
import { logger } from './logger.js';

/**
 * @typedef {Object} DealDetectionInput
 * @property {string} origin
 * @property {string} destination
 * @property {string} date
 * @property {number} price
 */

const detectSchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.number().positive()
});

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export async function detectDeal(input) {
  const parsed = detectSchema.parse(input);
  try {
    const [baseline, rows] = await Promise.all([
      computeBaseline(parsed),
      getHistoricalPrices({
        origin: parsed.origin,
        destination: parsed.destination,
        dateFrom: `${String(parsed.date).slice(0, 4)}-01-01`,
        dateTo: parsed.date,
        limit: 5000
      })
    ]);
    const prices = rows.map((r) => Number(r.total_price)).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    const value = Number(parsed.price);
    const deviation = computeDeviation(value, baseline.baseline);
    const belowBaseline65 = value < baseline.baseline * 0.65;
    const belowP10 = baseline.p10 > 0 && value < baseline.p10;
    const belowP25 = baseline.p25 > 0 && value < baseline.p25;
    const anomaly = robustAnomalySignal(prices, value);

    const sample = Math.max(1, baseline.observationCount || prices.length);
    const lowerCount = prices.filter((p) => p <= value).length;
    const historicalPercentile = clamp01(lowerCount / sample);
    const rarity = rarityFromSample({
      observationCount: sample,
      belowP10,
      anomaly: anomaly.isAnomaly
    });
    const dropPct = Math.max(0, -deviation.percent);
    const dealType = inferDealType({ dropPct, belowP10, anomaly: anomaly.isAnomaly, belowP25 });
    const dealScore = rankDeal({
      priceDropPct: dropPct,
      rarity,
      historicalPercentile,
      destinationPopularity: clamp01(sample / 2000)
    });

    return {
      deal_score: dealScore,
      deal_type: dealType,
      rules: {
        below_baseline_65: belowBaseline65,
        below_p10: belowP10,
        anomaly: anomaly.isAnomaly
      },
      baseline: {
        baseline_price: baseline.baseline,
        p10: baseline.p10,
        p25: baseline.p25,
        p50: baseline.medianPrice,
        p90: baseline.p90,
        observation_count: sample
      },
      deviation,
      confidence: {
        historical_percentile: Number(historicalPercentile.toFixed(4)),
        rarity
      }
    };
  } catch (error) {
    logger.error({ err: error, route: parsed }, 'detect_deal_failed');
    throw error;
  }
}

/**
 * Deal engine v2: anomaly + seasonal context + predictor + ranked confidence.
 * @param {DealDetectionInput & { stopCount?: number, isNightFlight?: boolean, comfortScore?: number }} input
 */
export async function detectDealV2(input) {
  const parsed = detectSchema.extend({
    stopCount: z.number().int().min(0).max(3).optional(),
    isNightFlight: z.boolean().optional(),
    comfortScore: z.number().int().min(1).max(100).optional()
  }).parse(input);

  const baseline = await computeBaseline(parsed);
  const anomaly = detectPriceAnomaly({
    price: parsed.price,
    baselineP50: baseline.baseline,
    baselineP25: baseline.p25 || baseline.baseline * 0.85,
    baselineP75: baseline.p75 || baseline.baseline * 1.15,
    stopCount: parsed.stopCount || 0,
    isNightFlight: Boolean(parsed.isNightFlight),
    comfortScore: parsed.comfortScore || 70
  });
  const month = Number(String(parsed.date).slice(5, 7));
  const season = buildSeasonalContext({ destinationIata: parsed.destination, month });
  const predictor = predictPriceDirection({
    departureDate: parsed.date,
    baselineP25: baseline.p25 || baseline.baseline * 0.85,
    baselineP50: baseline.baseline,
    baselineP75: baseline.p75 || baseline.baseline * 1.15,
    currentPrice: parsed.price
  });
  const ranked = rankDealV2({
    dealDelta: anomaly.dealDelta,
    zRobust: anomaly.zRobust,
    comfortScore: parsed.comfortScore || 70,
    seasonalityBonus: season.seasonBand === 'shoulder' ? 0.2 : season.seasonBand === 'low' ? 0.14 : -0.08,
    penalties: anomaly.penalty,
    riskNote: predictor.riskNote
  });

  return {
    isDeal: anomaly.isDeal,
    deal_delta: anomaly.dealDelta,
    z_robust: anomaly.zRobust,
    baseline: {
      p25: baseline.p25,
      p50: baseline.baseline,
      p75: baseline.p75
    },
    season,
    predictor,
    dealConfidence: ranked.dealConfidence,
    why: ranked.why,
    riskNote: ranked.riskNote
  };
}
