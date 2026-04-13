import type { TravelScoreBounds, TravelScoreItinerary, TravelScoreWeights } from '../types/index.ts';
import { scoreDurationPenalty } from './score-duration-penalty.ts';
import { scorePricePenalty } from './score-price-penalty.ts';
import { scoreStopsPenalty } from './score-stops-penalty.ts';
import { clampScore } from './score-metric-utils.ts';

export const DEFAULT_TRAVEL_SCORE_WEIGHTS: TravelScoreWeights = {
  // MVP weights:
  // - price has highest impact (55%)
  // - duration has medium impact (30%)
  // - stops has smaller but explicit impact (15%)
  // Weights are normalized again at runtime to keep scoring deterministic
  // even if custom weights are provided with different scales.
  price: 0.55,
  duration: 0.3,
  stops: 0.15
};

function toFiniteOrFallback(value: number | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizeWeights(weights: TravelScoreWeights): TravelScoreWeights {
  const price = Math.max(0, Number(weights.price) || 0);
  const duration = Math.max(0, Number(weights.duration) || 0);
  const stops = Math.max(0, Number(weights.stops) || 0);
  const total = price + duration + stops;
  if (total <= 0) return DEFAULT_TRAVEL_SCORE_WEIGHTS;
  return {
    price: price / total,
    duration: duration / total,
    stops: stops / total
  };
}

export function computeTravelScore(
  itinerary: TravelScoreItinerary,
  bounds: TravelScoreBounds,
  weights: TravelScoreWeights = DEFAULT_TRAVEL_SCORE_WEIGHTS
): number {
  // Penalties are normalized in [0, 1].
  // Final score is a bounded inverse penalty:
  // 100 => best itinerary in the current comparable set
  // 0   => worst itinerary in the current comparable set
  const normalizedWeights = normalizeWeights(weights);
  const pricePenalty = scorePricePenalty(toFiniteOrFallback(itinerary.price, bounds.maxPrice), bounds);
  const durationPenalty = scoreDurationPenalty(toFiniteOrFallback(itinerary.durationHours, bounds.maxDurationHours), bounds);
  const stopsPenalty = scoreStopsPenalty(toFiniteOrFallback(itinerary.stopCount ?? itinerary.stops, bounds.maxStops), bounds);

  const weightedPenalty =
    pricePenalty * normalizedWeights.price + durationPenalty * normalizedWeights.duration + stopsPenalty * normalizedWeights.stops;
  const score = Math.round(100 * (1 - weightedPenalty));
  return clampScore(score);
}
