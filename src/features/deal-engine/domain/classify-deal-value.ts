import type { DealSignals, DealValueClassification } from '../types/index.ts';

export const DEAL_VALUE_THRESHOLDS = {
  greatDeal: {
    minSavingPct: 25,
    minTravelScore: 75
  },
  goodValue: {
    minSavingPct: 12,
    minTravelScore: 60
  },
  goodValueHighScoreFallback: {
    minTravelScore: 88,
    minSavingPct: 5
  },
  overpriced: {
    maxSavingPct: -5,
    maxTravelScore: 45,
    maxSavingPctWithLowScore: 5
  },
  fairPrice: {
    lowSavingHintMaxPct: 8
  }
} as const;

const DEAL_PRIORITY: Record<DealValueClassification['label'], number> = {
  great_deal: 4,
  good_value: 3,
  fair_price: 2,
  overpriced: 1
};

function createClassification(label: DealValueClassification['label'], reason: string): DealValueClassification {
  return {
    label,
    priority: DEAL_PRIORITY[label],
    reason
  };
}

/**
 * Deterministic classification based on explicit thresholds:
 * - strong negative saving => overpriced
 * - strong saving + solid score => great_deal
 * - moderate saving + acceptable score => good_value
 * - otherwise fair_price
 */
export function classifyDealValue(signals: DealSignals): DealValueClassification {
  const savingPct = signals.savingPctVs2024;
  const travelScore = signals.travelScore;

  if (savingPct !== null && savingPct <= DEAL_VALUE_THRESHOLDS.overpriced.maxSavingPct) {
    return createClassification('overpriced', 'Current price is above 2024 baseline');
  }

  if (
    travelScore !== null &&
    travelScore <= DEAL_VALUE_THRESHOLDS.overpriced.maxTravelScore &&
    (savingPct === null || savingPct < DEAL_VALUE_THRESHOLDS.overpriced.maxSavingPctWithLowScore)
  ) {
    return createClassification('overpriced', 'Low score for current price');
  }

  if (
    savingPct !== null &&
    travelScore !== null &&
    savingPct >= DEAL_VALUE_THRESHOLDS.greatDeal.minSavingPct &&
    travelScore >= DEAL_VALUE_THRESHOLDS.greatDeal.minTravelScore
  ) {
    return createClassification('great_deal', 'High score and strong saving');
  }

  if (
    savingPct !== null &&
    travelScore !== null &&
    savingPct >= DEAL_VALUE_THRESHOLDS.goodValue.minSavingPct &&
    travelScore >= DEAL_VALUE_THRESHOLDS.goodValue.minTravelScore
  ) {
    return createClassification('good_value', 'Solid score with good saving');
  }

  if (
    travelScore !== null &&
    travelScore >= DEAL_VALUE_THRESHOLDS.goodValueHighScoreFallback.minTravelScore &&
    (savingPct === null || savingPct >= DEAL_VALUE_THRESHOLDS.goodValueHighScoreFallback.minSavingPct)
  ) {
    return createClassification('good_value', 'High score with moderate saving');
  }

  if (savingPct !== null && savingPct < DEAL_VALUE_THRESHOLDS.fairPrice.lowSavingHintMaxPct) {
    return createClassification('fair_price', 'Low saving for current price');
  }

  return createClassification('fair_price', 'Balanced price and quality');
}

