import { computeRadarSignals } from './compute-radar-signals.ts';
import { evaluateRadarState } from './evaluate-radar-state.ts';
import type { RadarSignalInput, RadarSignals } from '../types/index.ts';

interface DecoratedRadarItem<T> {
  index: number;
  item: T;
  radarPriority: number;
  signals: RadarSignals;
}

function toComparableNumber(value: number | null, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
}

export function sortByRadarPriority<T extends RadarSignalInput>(itineraries: T[]): T[] {
  const list = Array.isArray(itineraries) ? itineraries : [];

  const decorated: Array<DecoratedRadarItem<T>> = list.map((item, index) => {
    const signals = computeRadarSignals(item);
    const evaluation = evaluateRadarState(signals);
    return {
      index,
      item,
      radarPriority: evaluation.priority,
      signals
    };
  });

  decorated.sort((a, b) => {
    const priorityDelta = b.radarPriority - a.radarPriority;
    if (priorityDelta !== 0) return priorityDelta;

    const scoreDelta = toComparableNumber(b.signals.travelScore, -1) - toComparableNumber(a.signals.travelScore, -1);
    if (scoreDelta !== 0) return scoreDelta;

    const savingPctDelta =
      toComparableNumber(b.signals.savingPctVs2024, Number.NEGATIVE_INFINITY) -
      toComparableNumber(a.signals.savingPctVs2024, Number.NEGATIVE_INFINITY);
    if (savingPctDelta !== 0) return savingPctDelta;

    const dealPriorityDelta =
      toComparableNumber(b.signals.dealPriority, Number.NEGATIVE_INFINITY) -
      toComparableNumber(a.signals.dealPriority, Number.NEGATIVE_INFINITY);
    if (dealPriorityDelta !== 0) return dealPriorityDelta;

    const priceDelta = toComparableNumber(a.signals.price, Number.POSITIVE_INFINITY) - toComparableNumber(b.signals.price, Number.POSITIVE_INFINITY);
    if (priceDelta !== 0) return priceDelta;

    return a.index - b.index;
  });

  return decorated.map((entry) => entry.item);
}

