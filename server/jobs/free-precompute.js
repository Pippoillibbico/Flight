import { addDays, formatISO } from 'date-fns';
import { createHash } from 'node:crypto';
import { DESTINATIONS, ORIGINS } from '../data/flights-data.js';
import { upsertNightlyPrecompute } from '../lib/free-foundation-store.js';
import { getCacheClient } from '../lib/free-cache.js';
import { appendImmutableAudit } from '../lib/audit-log.js';
import { findCheapestWindows } from '../lib/window-finder-engine.js';
import { detectDealV2 } from '../lib/deal-detector.js';

const BUDGET_BUCKETS = ['low', 'mid', 'high'];
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const MOODS = ['relax', 'adventure', 'culture', 'nature', 'nightlife'];

function seeded(seed) {
  const hash = createHash('sha256').update(seed).digest('hex');
  return parseInt(hash.slice(0, 8), 16) / 0xffffffff;
}

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function seasonModifier(season, destination) {
  const warm = /mediterranean|tropical|subtropical/i.test(String(destination.climate || ''));
  if (season === 'summer') return warm ? 86 : 74;
  if (season === 'winter') return warm ? 82 : 66;
  if (season === 'spring') return 80;
  return 78;
}

function moodModifier(mood, destination) {
  const area = String(destination.area || '').toLowerCase();
  if (mood === 'culture') return area.includes('eu') ? 84 : 72;
  if (mood === 'nature') return area.includes('oceania') || area.includes('america') ? 83 : 74;
  if (mood === 'nightlife') return area.includes('asia') ? 82 : 73;
  if (mood === 'adventure') return 80;
  return 79;
}

function budgetModifier(bucket, destination) {
  const p = Number(destination.basePrice || 400);
  if (bucket === 'low') return clamp(100 - p / 7);
  if (bucket === 'mid') return clamp(100 - p / 10 + 10);
  return clamp(100 - p / 14 + 16);
}

function travelFactors(origin, destination) {
  const seed = `${origin}-${destination.iata}-factors`;
  const basePrice = Number(destination.basePrice || 450);
  const flightFactor = clamp(100 - basePrice / 8 + seeded(seed + '-ff') * 8);
  const lodgingFactor = clamp(72 + seeded(seed + '-lf') * 18);
  const climateFactor = clamp(seasonModifier('spring', destination) + seeded(seed + '-cf') * 10 - 5);
  const crowdingFactor = clamp(66 + seeded(seed + '-cr') * 16);
  const seasonalityFactor = clamp(68 + seeded(seed + '-ss') * 20);
  const eventsFactor = clamp(60 + seeded(seed + '-ev') * 24);
  const travelScore = clamp(
    0.34 * flightFactor +
      0.2 * lodgingFactor +
      0.15 * climateFactor +
      0.11 * crowdingFactor +
      0.1 * seasonalityFactor +
      0.1 * eventsFactor
  );
  return {
    originIata: origin,
    destinationIata: destination.iata,
    destinationCity: destination.city,
    travelScore: Number(travelScore.toFixed(2)),
    flightFactor: Number(flightFactor.toFixed(2)),
    lodgingFactor: Number(lodgingFactor.toFixed(2)),
    climateFactor: Number(climateFactor.toFixed(2)),
    crowdingFactor: Number(crowdingFactor.toFixed(2)),
    seasonalityFactor: Number(seasonalityFactor.toFixed(2)),
    eventsFactor: Number(eventsFactor.toFixed(2))
  };
}

function buildSignals(origin, destination) {
  const seedBase = `${origin}-${destination.iata}-signal`;
  const now = new Date();
  const windowStart = addDays(now, 7 + Math.floor(seeded(seedBase + '-ws') * 21));
  const windowEnd = addDays(windowStart, 4 + Math.floor(seeded(seedBase + '-we') * 10));
  const anomalyThreshold = Math.max(55, Number(destination.basePrice || 400) * (0.72 + seeded(seedBase + '-at') * 0.14));
  const trendRaw = seeded(seedBase + '-td');
  const trendDirection = trendRaw > 0.62 ? 'up' : trendRaw < 0.38 ? 'down' : 'flat';
  return {
    originIata: origin,
    destinationIata: destination.iata,
    strategicWindowStart: formatISO(windowStart, { representation: 'date' }),
    strategicWindowEnd: formatISO(windowEnd, { representation: 'date' }),
    anomalyPriceThreshold: Number(anomalyThreshold.toFixed(2)),
    trendDirection
  };
}

export async function runNightlyFreePrecompute({ reason = 'manual' } = {}) {
  const rankings = [];
  const scores = [];
  const signals = [];
  const windowCaches = [];
  const dealCaches = [];

  for (const origin of ORIGINS) {
    for (const destination of DESTINATIONS) {
      scores.push(travelFactors(origin.code, destination));
      signals.push(buildSignals(origin.code, destination));
    }

    for (const budgetBucket of BUDGET_BUCKETS) {
      for (const season of SEASONS) {
        for (const mood of MOODS) {
          const ranked = DESTINATIONS.map((destination) => {
            const t = travelFactors(origin.code, destination);
            const finalScore = clamp(
              0.52 * t.travelScore +
                0.3 * budgetModifier(budgetBucket, destination) +
                0.1 * seasonModifier(season, destination) +
                0.08 * moodModifier(mood, destination)
            );
            return {
              originIata: origin.code,
              budgetBucket,
              season,
              mood,
              destinationIata: destination.iata,
              destinationCity: destination.city,
              finalScore: Number(finalScore.toFixed(2)),
              travelScore: t.travelScore
            };
          })
            .sort((a, b) => b.finalScore - a.finalScore)
            .slice(0, 12)
            .map((item, idx) => ({ ...item, rankPosition: idx + 1 }));
          rankings.push(...ranked);
        }
      }
    }
  }

  await upsertNightlyPrecompute({ rankings, scores, signals });

  const cache = getCacheClient();
  await cache.del('free:data:version');
  await cache.setex('free:data:version', 24 * 3600, String(Date.now()));

  const now = new Date();
  const horizonFrom = formatISO(addDays(now, 10), { representation: 'date' });
  const horizonTo = formatISO(addDays(now, 95), { representation: 'date' });

  for (const origin of ORIGINS) {
    const windowResult = findCheapestWindows({
      origin: origin.code,
      dateFrom: horizonFrom,
      dateTo: horizonTo,
      stayDays: 5,
      region: 'all',
      travellers: 1,
      cabinClass: 'economy',
      topN: 20
    });

    const windows = (windowResult.windows || []).slice(0, 12);
    windowCaches.push({
      origin: origin.code,
      generatedAt: new Date().toISOString(),
      horizonFrom,
      horizonTo,
      items: windows
    });

    for (const item of windows) {
      const evaluated = await detectDealV2({
        origin: item.origin,
        destination: item.destinationIata,
        date: item.dateFrom,
        price: item.price,
        stopCount: item.stopCount,
        isNightFlight: item.isNightFlight,
        comfortScore: item.comfortScore
      });
      dealCaches.push({
        origin: item.origin,
        destination: item.destination,
        destinationIata: item.destinationIata,
        dateFrom: item.dateFrom,
        dateTo: item.dateTo,
        price: item.price,
        comfortScore: item.comfortScore,
        dealConfidence: evaluated.dealConfidence,
        why: evaluated.why,
        riskNote: evaluated.riskNote,
        seasonLabel: evaluated?.season?.seasonLabel || null
      });
    }
  }

  dealCaches.sort((a, b) => b.dealConfidence - a.dealConfidence || a.price - b.price);
  await cache.setex(
    'free:precompute:windows:v2',
    24 * 3600,
    JSON.stringify({ generatedAt: new Date().toISOString(), horizonFrom, horizonTo, origins: windowCaches })
  );
  await cache.setex(
    'free:precompute:deals:v2',
    24 * 3600,
    JSON.stringify({ generatedAt: new Date().toISOString(), horizonFrom, horizonTo, items: dealCaches.slice(0, 120) })
  );

  appendImmutableAudit({
    category: 'free_precompute',
    type: 'nightly_refresh',
    success: true,
    detail: `reason=${reason}; rankings=${rankings.length}; scores=${scores.length}; signals=${signals.length}; windows=${windowCaches.length}; deals=${dealCaches.length}`
  }).catch(() => {});
}
