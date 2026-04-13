import { classifyDealValue } from './classify-deal-value.ts';
import { computeDealSignals } from './compute-deal-signals.ts';
import type { DealAnnotatedFields, DealSignalInput } from '../types/index.ts';

export function enrichItinerariesWithDeal<T extends DealSignalInput>(itineraries: T[]): Array<T & DealAnnotatedFields> {
  const list = Array.isArray(itineraries) ? itineraries : [];
  return list.map((item) => {
    const dealSignals = computeDealSignals(item);
    const classification = classifyDealValue(dealSignals);
    return {
      ...item,
      dealLabel: classification.label,
      dealPriority: classification.priority,
      dealReason: classification.reason,
      dealSignals
    };
  });
}

