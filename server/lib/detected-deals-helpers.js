import { createHash } from 'node:crypto';

const DEAL_SCORE_WEIGHTS = Object.freeze({
  savings_percent: 0.4,
  route_popularity: 0.2,
  freshness: 0.15,
  user_interest: 0.15,
  low_stops: 0.1
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function round2(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function parseJsonObject(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeRouteId(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function confidenceMultiplier(level) {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'high') return 1;
  if (normalized === 'medium') return 0.95;
  if (normalized === 'low') return 0.88;
  return 0.78;
}

function opportunityLevelFromScore(score) {
  const value = toNumber(score, 0);
  if (value >= 86) return 'Rare opportunity';
  if (value >= 75) return 'Exceptional price';
  if (value >= 62) return 'Great deal';
  return 'Ignore if too weak';
}

function dealTypeFromScore(score) {
  const value = toNumber(score, 0);
  if (value >= 86) return 'rare_opportunity';
  if (value >= 75) return 'exceptional_price';
  return 'great_deal';
}

function scoreStops(stops) {
  const value = Math.max(0, Math.floor(toNumber(stops, 1)));
  if (value === 0) return 100;
  if (value === 1) return 75;
  if (value === 2) return 50;
  if (value === 3) return 25;
  return 0;
}

function scoreDurationMinutes(durationMinutes) {
  const value = toNumber(durationMinutes, Number.NaN);
  if (!Number.isFinite(value) || value <= 0) return 60;
  if (value <= 180) return 100;
  if (value <= 360) return 88;
  if (value <= 540) return 76;
  if (value <= 780) return 62;
  if (value <= 1080) return 48;
  return 34;
}

function toIso(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function hasSqliteTable(sqliteDb, tableName) {
  const row = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(String(tableName || '').trim());
  return Boolean(row?.name);
}

function buildDealKey({ flightQuoteId, routeId, observedAt }) {
  const hash = createHash('sha1')
    .update(`${String(flightQuoteId)}|${String(routeId)}|${String(observedAt)}`)
    .digest('hex')
    .slice(0, 14);
  return `fq_${String(flightQuoteId)}_${hash}`;
}

function evaluateCandidate(row, { nowTs, minDiscountPct, nearMinRatio, rapidDropRatio, rapidDropMinPct, minScore, publishScore, expiryHours }) {
  const price = toNumber(row.total_price, 0);
  const avgPrice = toNumber(row.avg_price, 0);
  const minPrice = Math.max(0.01, toNumber(row.min_price, 0.01));
  const avg7 = Math.max(0, toNumber(row.avg_price_7d, avgPrice));
  const avg30 = Math.max(0, toNumber(row.avg_price_30d, avgPrice));
  const quoteSource = String(row.quote_source || row.source || '').trim().toLowerCase();
  const quoteMetadata = parseJsonObject(row.quote_metadata ?? row.metadata, {});
  const bootstrapFinalScore = toNumber(quoteMetadata.finalScore, Number.NaN);
  const bootstrapBaselinePrice = toNumber(quoteMetadata.baselinePrice, Number.NaN);
  const bootstrapSavingsPct = toNumber(quoteMetadata.savingsPct, Number.NaN);
  const bootstrapSavingsAmount = toNumber(quoteMetadata.savingsAmount, Number.NaN);
  const bootstrapOpportunityLevel = String(quoteMetadata.opportunityLevel || '').trim();
  const quotesCount = Math.max(0, toNumber(row.quotes_count, 0));
  const sparseHistoricalStats = quotesCount <= 2 || Math.abs(avgPrice - price) < 0.01;
  const bootstrapFallbackEligible =
    quoteSource === 'opportunity_bootstrap' &&
    quoteMetadata.bootstrap === true &&
    sparseHistoricalStats &&
    Number.isFinite(bootstrapFinalScore) &&
    bootstrapFinalScore >= minScore;
  const popularityRaw = Math.max(0, toNumber(row.route_popularity_30d, 0));
  const userSignalsRaw = Math.max(0, toNumber(row.user_signals_30d, 0));
  const observedAt = toIso(row.observed_at);
  const observedTs = new Date(observedAt).getTime();
  const ageHours = Math.max(0, (nowTs - observedTs) / (60 * 60 * 1000));

  if (price <= 0 || avgPrice <= 0) {
    return { valid: false, reason: 'invalid_price_or_baseline' };
  }

  const discountPct = ((avgPrice - price) / avgPrice) * 100;
  const nearMinDistancePct = ((price - minPrice) / minPrice) * 100;
  const rapidDropPct7d = avg7 > 0 ? ((avg7 - price) / avg7) * 100 : 0;
  const rapidDropPct30d = avg30 > 0 ? ((avg30 - price) / avg30) * 100 : 0;
  const prevPrice = toNumber(row.prev_price, 0);
  const rapidDropPctPrev = prevPrice > 0 ? ((prevPrice - price) / prevPrice) * 100 : 0;

  const isBelowHistoricalAvg = price < avgPrice && discountPct >= minDiscountPct;
  const isNearHistoricalMin = price <= minPrice * nearMinRatio;
  const isRapidDropBy7d = avg7 > 0 && price <= avg7 * rapidDropRatio && rapidDropPct7d >= rapidDropMinPct;
  const isRapidDropBy30d = avg30 > 0 && price <= avg30 * rapidDropRatio && rapidDropPct30d >= rapidDropMinPct;
  const isRapidDropByPrevious = prevPrice > 0 && rapidDropPctPrev >= rapidDropMinPct;
  const isRapidDrop = isRapidDropBy7d || isRapidDropBy30d || isRapidDropByPrevious;
  const gatesPassed = isBelowHistoricalAvg && isNearHistoricalMin && isRapidDrop;
  const usedBootstrapFallback = !gatesPassed && bootstrapFallbackEligible;

  if (!gatesPassed && !usedBootstrapFallback) {
    if (!isBelowHistoricalAvg) return { valid: false, reason: 'not_below_historical_avg' };
    if (!isNearHistoricalMin) return { valid: false, reason: 'not_near_historical_min' };
    return { valid: false, reason: 'price_not_dropping_fast' };
  }

  const discountScore = clamp((discountPct / 30) * 100, 0, 100);
  const popularityScore = clamp((Math.log1p(popularityRaw) / Math.log1p(400)) * 100, 0, 100);
  const durationScore = scoreDurationMinutes(row.duration_minutes);
  const stopsScore = scoreStops(row.stops);
  const freshnessScore = clamp(100 - ageHours * 2, 0, 100);
  const userSignalsScore = clamp((Math.log1p(userSignalsRaw) / Math.log1p(120)) * 100, 0, 100);
  const effectiveSavingsPct = Number.isFinite(bootstrapSavingsPct)
    ? bootstrapSavingsPct
    : Number.isFinite(bootstrapBaselinePrice) && bootstrapBaselinePrice > 0
      ? ((bootstrapBaselinePrice - price) / bootstrapBaselinePrice) * 100
      : discountPct;
  const savingsPercentScore = clamp(Math.max(0, effectiveSavingsPct), 0, 100);
  const lowStopsBonus = stopsScore;
  const dealScore = round2(
    savingsPercentScore * DEAL_SCORE_WEIGHTS.savings_percent +
      popularityScore * DEAL_SCORE_WEIGHTS.route_popularity +
      freshnessScore * DEAL_SCORE_WEIGHTS.freshness +
      userSignalsScore * DEAL_SCORE_WEIGHTS.user_interest +
      lowStopsBonus * DEAL_SCORE_WEIGHTS.low_stops
  );

  const rawScore =
    discountScore * 0.41 +
    popularityScore * 0.15 +
    durationScore * 0.08 +
    stopsScore * 0.12 +
    freshnessScore * 0.14 +
    userSignalsScore * 0.1;

  const nearMinStrength = clamp((nearMinRatio - price / minPrice) / Math.max(0.0001, nearMinRatio - 1), 0, 1);
  const rapidDropStrength = clamp(Math.max(rapidDropPct7d, rapidDropPct30d, rapidDropPctPrev) / 25, 0, 1);
  const confidence = confidenceMultiplier(row.confidence_level);
  const boostedFinal = rawScore * confidence + nearMinStrength * 6 + rapidDropStrength * 8;
  const computedFinalScore = clamp(round2(boostedFinal), 0, 100);
  const finalScore = usedBootstrapFallback ? clamp(Math.max(computedFinalScore, bootstrapFinalScore), 0, 100) : computedFinalScore;

  if (finalScore < minScore) return { valid: false, reason: 'score_too_low' };

  const baselinePriceRaw = Number.isFinite(bootstrapBaselinePrice) && bootstrapBaselinePrice > 0 ? bootstrapBaselinePrice : avgPrice;
  const baselinePrice = round2(Math.max(price, baselinePriceRaw));
  const savingsAmountRaw = Number.isFinite(bootstrapSavingsAmount) ? bootstrapSavingsAmount : baselinePrice - price;
  const savingsAmount = round2(Math.max(0, savingsAmountRaw));
  const savingsPct = round2(Math.max(0, Number.isFinite(bootstrapSavingsPct) ? bootstrapSavingsPct : effectiveSavingsPct));
  const status = finalScore >= publishScore ? 'published' : 'candidate';
  const publishedAt = status === 'published' ? new Date(nowTs).toISOString() : null;
  const expiresAt = new Date(observedTs + Math.max(1, Number(expiryHours || 120)) * 60 * 60 * 1000).toISOString();
  const opportunityLevel = usedBootstrapFallback && bootstrapOpportunityLevel ? bootstrapOpportunityLevel : opportunityLevelFromScore(finalScore);
  const rawRounded = round2(rawScore);
  const routeId = Number(row.route_id);
  const flightQuoteId = Number(row.flight_quote_id);

  return {
    valid: true,
    reason: null,
    finalScore,
    deal: {
      dealKey: buildDealKey({ flightQuoteId, routeId, observedAt }),
      flightQuoteId,
      routeId,
      dealType: dealTypeFromScore(finalScore),
      rawScore: rawRounded,
      finalScore,
      dealScore,
      opportunityLevel,
      price: round2(price),
      baselinePrice,
      savingsAmount,
      savingsPct,
      status,
      rejectionReason: null,
      scoreBreakdown: {
        model: 'detected_deals_v1',
        signals: {
          discount_pct: round2(discountPct),
          effective_savings_pct: round2(effectiveSavingsPct),
          near_min_distance_pct: round2(nearMinDistancePct),
          rapid_drop_pct_7d: round2(rapidDropPct7d),
          rapid_drop_pct_30d: round2(rapidDropPct30d),
          rapid_drop_pct_prev: round2(rapidDropPctPrev),
          route_popularity_30d: round2(popularityRaw),
          duration_minutes: toNumber(row.duration_minutes, 0),
          user_signals_30d: round2(userSignalsRaw),
          confidence_level: String(row.confidence_level || 'very_low')
        },
        components: {
          discount: round2(discountScore),
          popularity: round2(popularityScore),
          duration: round2(durationScore),
          stops: round2(stopsScore),
          freshness: round2(freshnessScore),
          user_signals: round2(userSignalsScore)
        },
        feed_ranking: {
          model: 'deal_score_v1',
          weights: DEAL_SCORE_WEIGHTS,
          components: {
            savings_percent: round2(savingsPercentScore),
            route_popularity: round2(popularityScore),
            freshness: round2(freshnessScore),
            user_interest: round2(userSignalsScore),
            low_stops_bonus: round2(lowStopsBonus)
          },
          deal_score: dealScore
        },
        gates: {
          below_historical_avg: isBelowHistoricalAvg,
          near_historical_min: isNearHistoricalMin,
          rapid_drop: isRapidDrop,
          bootstrap_fallback: usedBootstrapFallback
        },
        params: {
          min_discount_pct: minDiscountPct,
          near_min_ratio: nearMinRatio,
          rapid_drop_ratio: rapidDropRatio,
          rapid_drop_min_pct: rapidDropMinPct
        }
      },
      publishedAt,
      expiresAt,
      sourceObservedAt: observedAt
    }
  };
}

export {
  clamp,
  evaluateCandidate,
  hasSqliteTable,
  normalizeRouteId,
  parseJsonObject,
  round2,
  toNumber
};
