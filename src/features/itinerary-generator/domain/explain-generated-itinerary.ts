import type { GeneratedItineraryCandidate, ItineraryGenerationPreferences } from '../types/index.ts';

export function explainGeneratedItinerary(
  candidate: GeneratedItineraryCandidate,
  preferences: ItineraryGenerationPreferences = {}
): string {
  const signals = candidate.generationSignals;
  const hasBudgetConstraint = Number.isFinite(Number(preferences.maxBudget)) && Number(preferences.maxBudget) > 0;
  const hasStopsConstraint = Number.isFinite(Number(preferences.maxStops)) && Number(preferences.maxStops) >= 0;

  if (candidate.itineraryType === 'multi_city') {
    return 'Multi-city composition with balanced value signals';
  }

  if (signals.radarScoreNorm >= 95 && signals.dealScoreNorm >= 90) {
    return 'Hot radar and strong deal signal';
  }

  if (signals.travelScoreNorm >= 82 && signals.dealScoreNorm >= 75) {
    return 'High score with strong value profile';
  }

  if (hasBudgetConstraint && hasStopsConstraint && signals.budgetFitScore >= 80 && signals.stopsFitScore >= 80) {
    return 'Fits budget and stop preference';
  }

  if (signals.dealScoreNorm >= 75) {
    return 'Value-forward option with good pricing signal';
  }

  if (signals.travelScoreNorm >= 70) {
    return 'Balanced route quality for your preferences';
  }

  return 'Stable option for the selected constraints';
}

