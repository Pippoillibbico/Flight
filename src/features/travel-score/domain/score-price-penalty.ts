import type { TravelScoreBounds } from '../types/index.ts';
import { normalizePenalty } from './score-metric-utils.ts';

export function scorePricePenalty(price: number, bounds: TravelScoreBounds): number {
  return normalizePenalty(price, bounds.minPrice, bounds.maxPrice);
}
