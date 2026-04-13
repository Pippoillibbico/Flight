import { computeRadarSignals } from './compute-radar-signals.ts';
import { evaluateRadarState } from './evaluate-radar-state.ts';
import type { RadarAnnotatedFields, RadarSignalInput } from '../types/index.ts';

export function enrichItinerariesWithRadar<T extends RadarSignalInput>(itineraries: T[]): Array<T & RadarAnnotatedFields> {
  const list = Array.isArray(itineraries) ? itineraries : [];
  return list.map((item) => {
    const radarSignals = computeRadarSignals(item);
    const evaluation = evaluateRadarState(radarSignals);
    return {
      ...item,
      radarState: evaluation.state,
      radarPriority: evaluation.priority,
      radarReason: evaluation.reason,
      radarSignals
    };
  });
}

