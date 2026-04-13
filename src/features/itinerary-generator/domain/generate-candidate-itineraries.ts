import { computeItineraryGenerationSignals } from './compute-itinerary-generation-signals.ts';
import type {
  GeneratedItineraryCandidate,
  ItineraryGenerationInput,
  ItineraryGenerationPreferences
} from '../types/index.ts';

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeIata(value: unknown): string {
  return normalizeText(value).toUpperCase();
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toPositiveNumberOrFallback(value: unknown, fallback: number): number {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function normalizeSingleItinerary(input: ItineraryGenerationInput): ItineraryGenerationInput | null {
  const id = normalizeText(input.id);
  const origin = normalizeIata(input.origin);
  const destinationIata = normalizeIata(input.destinationIata);
  if (!id || !origin || !destinationIata) return null;
  return {
    ...input,
    id,
    origin,
    destinationIata,
    destination: normalizeText(input.destination || destinationIata),
    currency: normalizeText(input.currency || 'EUR') || 'EUR'
  };
}

function toSingleCandidate(
  itinerary: ItineraryGenerationInput,
  preferences: ItineraryGenerationPreferences
): GeneratedItineraryCandidate {
  const signals = computeItineraryGenerationSignals(itinerary, preferences);
  return {
    candidateId: `single:${itinerary.id}`,
    itineraryType: 'single',
    sourceIds: [itinerary.id],
    viewItineraryId: itinerary.viewItineraryId || itinerary.id,
    origin: normalizeIata(itinerary.origin),
    destination: normalizeText(itinerary.destination || itinerary.destinationIata),
    destinationIata: normalizeIata(itinerary.destinationIata),
    price: toPositiveNumberOrFallback(itinerary.price, 0),
    currency: normalizeText(itinerary.currency || 'EUR') || 'EUR',
    dateFrom: normalizeText(itinerary.dateFrom) || undefined,
    dateTo: normalizeText(itinerary.dateTo) || undefined,
    durationHours: toFiniteNumber(itinerary.durationHours),
    stopCount: toFiniteNumber(itinerary.stopCount),
    comfortScore: toFiniteNumber(itinerary.comfortScore),
    travelScore: toFiniteNumber(itinerary.travelScore),
    dealLabel: itinerary.dealLabel,
    dealPriority: toFiniteNumber(itinerary.dealPriority),
    radarState: itinerary.radarState,
    radarPriority: toFiniteNumber(itinerary.radarPriority),
    generationSignals: signals,
    rankingScore: 0,
    rankingPriority: 0,
    explanation: ''
  };
}

function buildMultiCityCandidates(
  singles: GeneratedItineraryCandidate[],
  preferences: ItineraryGenerationPreferences
): GeneratedItineraryCandidate[] {
  if (!preferences.multiCityEnabled) return [];
  const byRankSeed = [...singles].sort((a, b) => {
    const priceDelta = a.price - b.price;
    if (priceDelta !== 0) return priceDelta;
    const scoreDelta = Number(b.travelScore || 0) - Number(a.travelScore || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return a.candidateId.localeCompare(b.candidateId);
  });

  const seed = byRankSeed.slice(0, 4);
  const composed: GeneratedItineraryCandidate[] = [];
  for (let i = 0; i < seed.length; i += 1) {
    for (let j = i + 1; j < seed.length; j += 1) {
      const first = seed[i];
      const second = seed[j];
      if (!first || !second) continue;
      const firstSourceId = normalizeText(first.sourceIds[0] || first.viewItineraryId || first.candidateId);
      const secondSourceId = normalizeText(second.sourceIds[0] || second.viewItineraryId || second.candidateId);
      if (!firstSourceId || !secondSourceId) continue;
      if (first.destinationIata === second.destinationIata) continue;
      const composedInput: ItineraryGenerationInput = {
        id: `${firstSourceId}__${secondSourceId}`,
        sourceType: 'search_result',
        origin: first.origin,
        destination: `${first.destination} + ${second.destination}`,
        destinationIata: `${first.destinationIata}-${second.destinationIata}`,
        price: first.price + second.price,
        currency: first.currency,
        durationHours: (first.durationHours || 0) + (second.durationHours || 0),
        stopCount: (first.stopCount || 0) + (second.stopCount || 0),
        comfortScore: first.comfortScore !== null && second.comfortScore !== null
          ? Math.round((first.comfortScore + second.comfortScore) / 2)
          : first.comfortScore ?? second.comfortScore ?? null,
        travelScore: first.travelScore !== null && second.travelScore !== null
          ? Math.round((first.travelScore + second.travelScore) / 2)
          : first.travelScore ?? second.travelScore ?? null,
        dealPriority: first.dealPriority !== null && second.dealPriority !== null
          ? Math.min(first.dealPriority, second.dealPriority)
          : first.dealPriority ?? second.dealPriority ?? null,
        radarPriority: first.radarPriority !== null && second.radarPriority !== null
          ? Math.min(first.radarPriority, second.radarPriority)
          : first.radarPriority ?? second.radarPriority ?? null,
        viewItineraryId: first.viewItineraryId || firstSourceId
      };
      const signals = computeItineraryGenerationSignals(composedInput, preferences);
      composed.push({
        candidateId: `multi:${firstSourceId}__${secondSourceId}`,
        itineraryType: 'multi_city',
        sourceIds: [firstSourceId, secondSourceId],
        viewItineraryId: first.viewItineraryId || firstSourceId,
        origin: normalizeIata(composedInput.origin),
        destination: normalizeText(composedInput.destination),
        destinationIata: normalizeText(composedInput.destinationIata),
        price: toPositiveNumberOrFallback(composedInput.price, 0),
        currency: normalizeText(composedInput.currency || 'EUR') || 'EUR',
        durationHours: toFiniteNumber(composedInput.durationHours),
        stopCount: toFiniteNumber(composedInput.stopCount),
        comfortScore: toFiniteNumber(composedInput.comfortScore),
        travelScore: toFiniteNumber(composedInput.travelScore),
        dealLabel: first.dealLabel === second.dealLabel ? first.dealLabel : undefined,
        dealPriority: toFiniteNumber(composedInput.dealPriority),
        radarState: first.radarState === second.radarState ? first.radarState : undefined,
        radarPriority: toFiniteNumber(composedInput.radarPriority),
        generationSignals: signals,
        rankingScore: 0,
        rankingPriority: 0,
        explanation: ''
      });
      if (composed.length >= 3) return composed;
    }
  }
  return composed;
}

export function generateCandidateItineraries(
  itineraries: ItineraryGenerationInput[],
  preferences: ItineraryGenerationPreferences = {}
): GeneratedItineraryCandidate[] {
  const normalized = (Array.isArray(itineraries) ? itineraries : [])
    .map((item) => normalizeSingleItinerary(item))
    .filter((item): item is ItineraryGenerationInput => Boolean(item));

  if (!normalized.length) return [];

  const normalizedOrigin = normalizeIata(preferences.origin);
  const maxStops = toFiniteNumber(preferences.maxStops);
  const filtered = normalized.filter((item) => {
    const matchesOrigin = normalizedOrigin ? normalizeIata(item.origin) === normalizedOrigin : true;
    const matchesStops = maxStops === null || toFiniteNumber(item.stopCount) === null || Number(item.stopCount) <= maxStops;
    return matchesOrigin && matchesStops;
  });

  const source = filtered.length > 0 ? filtered : normalized;
  const singles = source.map((item) => toSingleCandidate(item, preferences));
  const composed = buildMultiCityCandidates(singles, preferences);
  return [...singles, ...composed];
}
