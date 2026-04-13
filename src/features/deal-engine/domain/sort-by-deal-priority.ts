import { classifyDealValue } from './classify-deal-value.ts';
import { computeDealSignals } from './compute-deal-signals.ts';
import type { DealSignalInput, DealSignals } from '../types/index.ts';

function toComparableNumber(value: number | null, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
}

interface DecoratedDealRow<T> {
  index: number;
  item: T;
  priority: number;
  signals: DealSignals;
}

export function sortByDealPriority<T extends DealSignalInput>(itineraries: T[]): T[] {
  const list = Array.isArray(itineraries) ? itineraries : [];

  const decorated: Array<DecoratedDealRow<T>> = list.map((item, index) => {
    const signals = computeDealSignals(item);
    const classification = classifyDealValue(signals);
    return {
      index,
      item,
      priority: classification.priority,
      signals
    };
  });

  decorated.sort((a, b) => {
    const priorityDelta = b.priority - a.priority;
    if (priorityDelta !== 0) return priorityDelta;

    const scoreDelta = toComparableNumber(b.signals.travelScore, -1) - toComparableNumber(a.signals.travelScore, -1);
    if (scoreDelta !== 0) return scoreDelta;

    const savingPctDelta =
      toComparableNumber(b.signals.savingPctVs2024, Number.NEGATIVE_INFINITY) -
      toComparableNumber(a.signals.savingPctVs2024, Number.NEGATIVE_INFINITY);
    if (savingPctDelta !== 0) return savingPctDelta;

    const savingValueDelta =
      toComparableNumber(b.signals.savingVs2024, Number.NEGATIVE_INFINITY) -
      toComparableNumber(a.signals.savingVs2024, Number.NEGATIVE_INFINITY);
    if (savingValueDelta !== 0) return savingValueDelta;

    const priceDelta = toComparableNumber(a.signals.price, Number.POSITIVE_INFINITY) - toComparableNumber(b.signals.price, Number.POSITIVE_INFINITY);
    if (priceDelta !== 0) return priceDelta;

    return a.index - b.index;
  });

  return decorated.map((entry) => entry.item);
}

