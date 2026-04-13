import type { TravelScoreBounds } from '../types/index.ts';
import { normalizePenalty } from './score-metric-utils.ts';

export function scoreStopsPenalty(stops: number, bounds: TravelScoreBounds): number {
  return normalizePenalty(Math.max(0, Number(stops)), bounds.minStops, bounds.maxStops);
}
