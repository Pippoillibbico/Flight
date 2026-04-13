import type { MultiCityPayloadOptions, MultiCitySearchPayload, MultiCitySegment } from '../types/index.ts';
import { normalizeMultiCitySegment } from '../validation/validate-multi-city.ts';

export function buildMultiCitySearchPayload(segments: MultiCitySegment[], options: MultiCityPayloadOptions = {}): MultiCitySearchPayload {
  const normalizedSegments = (Array.isArray(segments) ? segments : []).map(normalizeMultiCitySegment);
  const firstSegment = normalizedSegments[0];
  const lastSegment = normalizedSegments[normalizedSegments.length - 1];

  return {
    mode: 'multi_city',
    segments: normalizedSegments.map((segment) => ({
      origin: segment.origin,
      destination: segment.destination,
      date: segment.date
    })),
    origin: firstSegment?.origin || String(options.originFallback || '').trim().toUpperCase(),
    destinationQuery: lastSegment?.destination || String(options.destinationQueryFallback || '').trim(),
    dateFrom: firstSegment?.date || '',
    dateTo: lastSegment?.date || undefined,
    region: options.region,
    country: options.country,
    cheapOnly: options.cheapOnly,
    maxBudget: options.maxBudget,
    connectionType: options.connectionType,
    maxStops: options.maxStops,
    travelTime: options.travelTime,
    minComfortScore: options.minComfortScore,
    travellers: options.travellers,
    cabinClass: options.cabinClass
  };
}
