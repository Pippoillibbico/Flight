import { computeTravelScore } from './compute-travel-score.ts';
import type { TravelScoreBounds, TravelScoreItinerary } from '../types/index.ts';

function toFiniteMetric(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function getMin(values: number[]): number {
  if (!values.length) return 0;
  return Math.min(...values);
}

function getMax(values: number[]): number {
  if (!values.length) return 0;
  return Math.max(...values);
}

export function computeTravelScoreBounds(itineraries: TravelScoreItinerary[]): TravelScoreBounds {
  const list = Array.isArray(itineraries) ? itineraries : [];
  const prices = list.map((item) => toFiniteMetric(item.price)).filter((value): value is number => value !== null);
  const durations = list.map((item) => toFiniteMetric(item.durationHours)).filter((value): value is number => value !== null);
  const stops = list
    .map((item) => toFiniteMetric(item.stopCount ?? item.stops))
    .filter((value): value is number => value !== null)
    .map((value) => Math.max(0, value));

  const minPrice = getMin(prices);
  const maxPrice = getMax(prices.length ? prices : [minPrice + 1]);
  const minDurationHours = getMin(durations);
  const maxDurationHours = getMax(durations.length ? durations : [minDurationHours + 1]);
  const minStops = getMin(stops);
  const maxStops = getMax(stops.length ? stops : [minStops + 1]);

  return {
    minPrice,
    maxPrice,
    minDurationHours,
    maxDurationHours,
    minStops,
    maxStops
  };
}

export function scoreItineraries<T extends Record<string, unknown>>(itineraries: T[]): Array<T & { travelScore: number }> {
  const list = Array.isArray(itineraries) ? itineraries : [];
  const bounds = computeTravelScoreBounds(list);
  return list.map((item) => ({
    ...item,
    travelScore: computeTravelScore(
      {
        price: Number(item.price),
        durationHours: Number(item.durationHours),
        stopCount: Number(item.stopCount ?? item.stops)
      },
      bounds
    )
  }));
}
