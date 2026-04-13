import type {
  GeneratedItineraryCandidate,
  GenerationBudgetSensitivity,
  GenerationValuePreference,
  ItineraryGenerationPreferences
} from '../types/index.ts';

interface RankingWeights {
  travel: number;
  deal: number;
  radar: number;
  budget: number;
  stops: number;
  comfort: number;
}

const BASE_RANKING_WEIGHTS: RankingWeights = {
  travel: 0.36,
  deal: 0.2,
  radar: 0.2,
  budget: 0.12,
  stops: 0.08,
  comfort: 0.04
};

function adjustWeightsForBudgetSensitivity(weights: RankingWeights, sensitivity: GenerationBudgetSensitivity): RankingWeights {
  if (sensitivity === 'high') {
    return {
      ...weights,
      travel: 0.32,
      budget: 0.2
    };
  }
  if (sensitivity === 'low') {
    return {
      ...weights,
      travel: 0.4,
      budget: 0.05
    };
  }
  return weights;
}

function adjustWeightsForValuePreference(weights: RankingWeights, preference: GenerationValuePreference): RankingWeights {
  if (preference !== 'value_focus') return weights;
  return {
    ...weights,
    travel: 0.32,
    deal: 0.24,
    radar: 0.24
  };
}

function normalizeWeights(weights: RankingWeights): RankingWeights {
  const total = weights.travel + weights.deal + weights.radar + weights.budget + weights.stops + weights.comfort;
  if (total <= 0) return BASE_RANKING_WEIGHTS;
  return {
    travel: weights.travel / total,
    deal: weights.deal / total,
    radar: weights.radar / total,
    budget: weights.budget / total,
    stops: weights.stops / total,
    comfort: weights.comfort / total
  };
}

function resolveWeights(preferences: ItineraryGenerationPreferences): RankingWeights {
  const budgetAdjusted = adjustWeightsForBudgetSensitivity(
    BASE_RANKING_WEIGHTS,
    preferences.budgetSensitivity || 'balanced'
  );
  return normalizeWeights(
    adjustWeightsForValuePreference(budgetAdjusted, preferences.valuePreference || 'balanced')
  );
}

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeRankingScore(candidate: GeneratedItineraryCandidate, weights: RankingWeights): number {
  const signals = candidate.generationSignals;
  const raw =
    signals.travelScoreNorm * weights.travel +
    signals.dealScoreNorm * weights.deal +
    signals.radarScoreNorm * weights.radar +
    signals.budgetFitScore * weights.budget +
    signals.stopsFitScore * weights.stops +
    signals.comfortFitScore * weights.comfort;
  return roundToSingleDecimal(raw);
}

export function rankGeneratedItineraries(
  candidates: GeneratedItineraryCandidate[],
  preferences: ItineraryGenerationPreferences = {}
): GeneratedItineraryCandidate[] {
  const list = Array.isArray(candidates) ? [...candidates] : [];
  const limit = Number.isFinite(Number(preferences.limit))
    ? Math.max(1, Math.min(12, Math.round(Number(preferences.limit))))
    : 5;
  const weights = resolveWeights(preferences);

  const scored = list.map((candidate, index) => {
    const rankingScore = computeRankingScore(candidate, weights);
    return {
      ...candidate,
      rankingScore,
      rankingPriority: Math.round(rankingScore * 10),
      __index: index
    };
  });

  scored.sort((a, b) => {
    const rankingDelta = b.rankingScore - a.rankingScore;
    if (rankingDelta !== 0) return rankingDelta;
    const priceDelta = Number(a.price || 0) - Number(b.price || 0);
    if (priceDelta !== 0) return priceDelta;
    const travelDelta = Number(b.travelScore || 0) - Number(a.travelScore || 0);
    if (travelDelta !== 0) return travelDelta;
    return a.__index - b.__index;
  });

  return scored.slice(0, limit).map(({ __index, ...candidate }) => candidate);
}

