import type { RadarEvaluation, RadarSignals, RadarState } from '../types/index.ts';

export const RADAR_STATE_THRESHOLDS = {
  hot: {
    minDealPriority: 4,
    minTravelScore: 80,
    minSavingPct: 18
  },
  watch: {
    minDealPriority: 3,
    minTravelScore: 68,
    minSavingPct: 8
  },
  none: {
    maxTravelScore: 55,
    maxSavingPct: 3
  }
} as const;

const RADAR_PRIORITY: Record<RadarState, number> = {
  radar_hot: 3,
  radar_watch: 2,
  radar_none: 1
};

function createEvaluation(state: RadarState, reason: string): RadarEvaluation {
  return {
    state,
    priority: RADAR_PRIORITY[state],
    reason
  };
}

/**
 * Deterministic MVP rules:
 * - radar_hot for clearly strong opportunities (top deal tier or score+saving combo)
 * - radar_watch for moderate opportunities worth monitoring
 * - radar_none for low-upside opportunities
 */
export function evaluateRadarState(signals: RadarSignals): RadarEvaluation {
  const dealPriority = signals.dealPriority;
  const travelScore = signals.travelScore;
  const savingPct = signals.savingPctVs2024;

  if (dealPriority !== null && dealPriority >= RADAR_STATE_THRESHOLDS.hot.minDealPriority) {
    return createEvaluation('radar_hot', 'Top-tier deal signal');
  }

  if (
    travelScore !== null &&
    savingPct !== null &&
    travelScore >= RADAR_STATE_THRESHOLDS.hot.minTravelScore &&
    savingPct >= RADAR_STATE_THRESHOLDS.hot.minSavingPct
  ) {
    return createEvaluation('radar_hot', 'High score with strong saving');
  }

  if (dealPriority !== null && dealPriority >= RADAR_STATE_THRESHOLDS.watch.minDealPriority) {
    return createEvaluation('radar_watch', 'Worth watching for value trend');
  }

  if (
    travelScore !== null &&
    savingPct !== null &&
    travelScore >= RADAR_STATE_THRESHOLDS.watch.minTravelScore &&
    savingPct >= RADAR_STATE_THRESHOLDS.watch.minSavingPct
  ) {
    return createEvaluation('radar_watch', 'Moderate score with positive saving');
  }

  if (
    travelScore !== null &&
    travelScore <= RADAR_STATE_THRESHOLDS.none.maxTravelScore &&
    (savingPct === null || savingPct <= RADAR_STATE_THRESHOLDS.none.maxSavingPct)
  ) {
    return createEvaluation('radar_none', 'Low upside right now');
  }

  return createEvaluation('radar_none', 'No strong radar trigger');
}

