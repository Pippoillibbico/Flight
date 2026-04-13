import type { RadarDealLabel, RadarSignalInput, RadarSignals } from '../types/index.ts';

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toPositiveFiniteNumber(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed <= 0) return null;
  return parsed;
}

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeDealLabel(value: unknown): RadarDealLabel | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'great_deal') return 'great_deal';
  if (normalized === 'good_value') return 'good_value';
  if (normalized === 'fair_price') return 'fair_price';
  if (normalized === 'overpriced') return 'overpriced';
  return null;
}

function normalizeRadarPriority(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  return Math.max(1, Math.min(4, Math.round(parsed)));
}

function normalizeTravelScore(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function readDealSignalsValue(source: unknown, key: 'savingVs2024' | 'savingPctVs2024'): number | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  return toFiniteNumber(record[key]);
}

export function computeRadarSignals(input: RadarSignalInput): RadarSignals {
  const price = toPositiveFiniteNumber(input.price);
  const avg2024 = toPositiveFiniteNumber(input.avg2024);

  const savingValueFromDealSignals = readDealSignalsValue(input.dealSignals, 'savingVs2024');
  const savingPctFromDealSignals = readDealSignalsValue(input.dealSignals, 'savingPctVs2024');

  const explicitSaving = toFiniteNumber(input.savingVs2024);
  const derivedSaving = avg2024 !== null && price !== null ? avg2024 - price : null;
  const savingVs2024 = explicitSaving ?? savingValueFromDealSignals ?? derivedSaving;

  const explicitSavingPct = toFiniteNumber(input.savingPctVs2024);
  const savingPctVs2024 =
    explicitSavingPct
    ?? savingPctFromDealSignals
    ?? (avg2024 !== null && avg2024 > 0 && savingVs2024 !== null
      ? roundToSingleDecimal((savingVs2024 / avg2024) * 100)
      : null);

  return {
    dealLabel: normalizeDealLabel(input.dealLabel),
    dealPriority: normalizeRadarPriority(input.dealPriority),
    travelScore: normalizeTravelScore(input.travelScore),
    savingVs2024,
    savingPctVs2024,
    price
  };
}

