import type { TravelScoreBounds } from '../types/index.ts';
import { normalizePenalty } from './score-metric-utils.ts';

export function scoreDurationPenalty(durationHours: number, bounds: TravelScoreBounds): number {
  return normalizePenalty(durationHours, bounds.minDurationHours, bounds.maxDurationHours);
}
