import type { AiTaskType } from '../types/ai-task-type.ts';

interface SanitizedGenerationInput {
  id: string;
  viewItineraryId?: string;
  sourceType?: string;
  origin?: string;
  destination?: string;
  destinationIata?: string;
  price?: number;
  currency?: string;
  dateFrom?: string;
  dateTo?: string;
  durationHours?: number;
  stopCount?: number | null;
  comfortScore?: number | null;
  travelScore?: number | null;
  dealLabel?: string;
  dealPriority?: number | null;
  radarState?: string;
  radarPriority?: number | null;
}

interface SanitizedGenerationPreferences {
  origin?: string;
  maxStops?: number | null;
  maxBudget?: number | null;
  minComfortScore?: number | null;
  budgetSensitivity?: 'low' | 'balanced' | 'high';
  valuePreference?: 'balanced' | 'value_focus';
  comfortPreference?: 'flexible' | 'balanced' | 'high';
  multiCityEnabled?: boolean;
  limit?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeText(value: unknown, maxLength: number): string {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[<>\u2028\u2029]/g, '')
    .trim();
  if (!normalized) return '';
  return normalized.slice(0, Math.max(1, Number(maxLength) || 80));
}

function sanitizeNumber(value: unknown, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, round = false } = {}): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const bounded = Math.max(min, Math.min(max, parsed));
  return round ? Math.round(bounded) : bounded;
}

function sanitizeInteger(value: unknown, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}): number | undefined {
  const out = sanitizeNumber(value, { min, max, round: true });
  return Number.isFinite(Number(out)) ? Number(out) : undefined;
}

function sanitizeNullableInteger(value: unknown, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}): number | null | undefined {
  if (value === null) return null;
  return sanitizeInteger(value, { min, max });
}

function sanitizeNullableNumber(value: unknown, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}): number | null | undefined {
  if (value === null) return null;
  return sanitizeNumber(value, { min, max });
}

function sanitizeGenerationInput(item: unknown): SanitizedGenerationInput | null {
  if (!isRecord(item)) return null;
  const id = sanitizeText(item.id || item.viewItineraryId, 80);
  if (!id) return null;

  const out: SanitizedGenerationInput = { id };
  const viewItineraryId = sanitizeText(item.viewItineraryId, 80);
  if (viewItineraryId) out.viewItineraryId = viewItineraryId;

  const sourceType = sanitizeText(item.sourceType, 32);
  if (sourceType) out.sourceType = sourceType;

  const origin = sanitizeText(item.origin, 3).toUpperCase();
  if (origin) out.origin = origin;

  const destination = sanitizeText(item.destination, 80);
  if (destination) out.destination = destination;

  const destinationIata = sanitizeText(item.destinationIata, 3).toUpperCase();
  if (destinationIata) out.destinationIata = destinationIata;

  const price = sanitizeNumber(item.price, { min: 0, max: 1_000_000 });
  if (price !== undefined) out.price = Math.round(price);

  const currency = sanitizeText(item.currency, 8).toUpperCase();
  if (currency) out.currency = currency;

  const dateFrom = sanitizeText(item.dateFrom, 16);
  if (dateFrom) out.dateFrom = dateFrom;

  const dateTo = sanitizeText(item.dateTo, 16);
  if (dateTo) out.dateTo = dateTo;

  const durationHours = sanitizeNumber(item.durationHours, { min: 0, max: 200 });
  if (durationHours !== undefined) out.durationHours = Math.round(durationHours * 100) / 100;

  const stopCount = sanitizeNullableInteger(item.stopCount, { min: 0, max: 6 });
  if (stopCount !== undefined) out.stopCount = stopCount;

  const comfortScore = sanitizeNullableNumber(item.comfortScore, { min: 0, max: 100 });
  if (comfortScore !== undefined) out.comfortScore = comfortScore;

  const travelScore = sanitizeNullableNumber(item.travelScore, { min: 0, max: 100 });
  if (travelScore !== undefined) out.travelScore = travelScore;

  const dealLabel = sanitizeText(item.dealLabel, 24).toLowerCase();
  if (dealLabel) out.dealLabel = dealLabel;

  const dealPriority = sanitizeNullableInteger(item.dealPriority, { min: 0, max: 10 });
  if (dealPriority !== undefined) out.dealPriority = dealPriority;

  const radarState = sanitizeText(item.radarState, 24).toLowerCase();
  if (radarState) out.radarState = radarState;

  const radarPriority = sanitizeNullableInteger(item.radarPriority, { min: 0, max: 10 });
  if (radarPriority !== undefined) out.radarPriority = radarPriority;

  return out;
}

function sanitizePreferences(value: unknown): SanitizedGenerationPreferences {
  if (!isRecord(value)) return {};
  const out: SanitizedGenerationPreferences = {};

  const origin = sanitizeText(value.origin, 3).toUpperCase();
  if (origin) out.origin = origin;

  const maxStops = sanitizeNullableInteger(value.maxStops, { min: 0, max: 6 });
  if (maxStops !== undefined) out.maxStops = maxStops;

  const maxBudget = sanitizeNullableInteger(value.maxBudget, { min: 0, max: 1_000_000 });
  if (maxBudget !== undefined) out.maxBudget = maxBudget;

  const minComfortScore = sanitizeNullableInteger(value.minComfortScore, { min: 0, max: 100 });
  if (minComfortScore !== undefined) out.minComfortScore = minComfortScore;

  const budgetSensitivity = sanitizeText(value.budgetSensitivity, 16).toLowerCase();
  if (budgetSensitivity === 'low' || budgetSensitivity === 'balanced' || budgetSensitivity === 'high') {
    out.budgetSensitivity = budgetSensitivity;
  }

  const valuePreference = sanitizeText(value.valuePreference, 16).toLowerCase();
  if (valuePreference === 'balanced' || valuePreference === 'value_focus') {
    out.valuePreference = valuePreference;
  }

  const comfortPreference = sanitizeText(value.comfortPreference, 16).toLowerCase();
  if (comfortPreference === 'flexible' || comfortPreference === 'balanced' || comfortPreference === 'high') {
    out.comfortPreference = comfortPreference;
  }

  if (typeof value.multiCityEnabled === 'boolean') out.multiCityEnabled = value.multiCityEnabled;

  const limit = sanitizeInteger(value.limit, { min: 1, max: 12 });
  if (limit !== undefined) out.limit = limit;

  return out;
}

export function minimizeAiInputForTask(taskType: AiTaskType, input: unknown): unknown {
  if (taskType !== 'itinerary_generation') return input;
  if (!isRecord(input)) {
    return {
      generationInputs: [],
      preferences: {}
    };
  }
  const generationInputsRaw = Array.isArray(input.generationInputs) ? input.generationInputs : [];
  const generationInputs = generationInputsRaw.map(sanitizeGenerationInput).filter((item): item is SanitizedGenerationInput => item !== null).slice(0, 60);

  return {
    generationInputs,
    preferences: sanitizePreferences(input.preferences)
  };
}

