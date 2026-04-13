import type {
  ItineraryGenerationInput,
  ItineraryGenerationPreferences,
  ItineraryGenerationSignals
} from '../types/index.ts';

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toBoundedNumber(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeTravelScore(value: unknown): number {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return 0;
  return Math.round(toBoundedNumber(parsed, 0, 100));
}

function normalizePriority(value: unknown, min: number, max: number): number {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return 0;
  return Math.round(toBoundedNumber(parsed, min, max));
}

function scoreBudgetFit(price: number | null, maxBudget: number | null): number {
  if (price === null) return 50;
  if (maxBudget === null || maxBudget <= 0) return 60;
  if (price <= maxBudget) {
    const headroomPct = ((maxBudget - price) / maxBudget) * 100;
    return Math.round(toBoundedNumber(70 + headroomPct, 70, 100));
  }
  const overPct = ((price - maxBudget) / maxBudget) * 100;
  return Math.round(toBoundedNumber(70 - overPct * 2, 0, 70));
}

function scoreStopsFit(stops: number | null, maxStops: number | null): number {
  if (stops === null) return 55;
  if (maxStops === null || maxStops < 0) return 65;
  if (stops <= maxStops) return 100;
  const overflow = stops - maxStops;
  return Math.round(toBoundedNumber(100 - overflow * 35, 0, 100));
}

function scoreComfortFit(comfortScore: number | null, comfortPreference: ItineraryGenerationPreferences['comfortPreference']): number {
  const score = comfortScore === null ? 55 : Math.round(toBoundedNumber(comfortScore, 0, 100));
  if (comfortPreference === 'high') return score;
  if (comfortPreference === 'flexible') return Math.round((score + 60) / 2);
  return Math.round((score + 70) / 2);
}

export function computeItineraryGenerationSignals(
  itinerary: ItineraryGenerationInput,
  preferences: ItineraryGenerationPreferences
): ItineraryGenerationSignals {
  const price = toFiniteNumber(itinerary.price);
  const maxBudget = toFiniteNumber(preferences.maxBudget);
  const maxStops = toFiniteNumber(preferences.maxStops);
  const comfortScore = toFiniteNumber(itinerary.comfortScore);
  const dealPriority = normalizePriority(itinerary.dealPriority, 0, 4);
  const radarPriority = normalizePriority(itinerary.radarPriority, 0, 3);

  return {
    travelScoreNorm: normalizeTravelScore(itinerary.travelScore),
    dealScoreNorm: Math.round((dealPriority / 4) * 100),
    radarScoreNorm: Math.round((radarPriority / 3) * 100),
    budgetFitScore: scoreBudgetFit(price, maxBudget),
    stopsFitScore: scoreStopsFit(toFiniteNumber(itinerary.stopCount), maxStops),
    comfortFitScore: scoreComfortFit(comfortScore, preferences.comfortPreference || 'balanced')
  };
}

