import type { DealSignalInput, DealSignals } from '../types/index.ts';

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

function toBoundedScore(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeDealSignals(input: DealSignalInput): DealSignals {
  const price = toPositiveFiniteNumber(input.price);
  const avg2024 = toPositiveFiniteNumber(input.avg2024);
  const explicitSaving = toFiniteNumber(input.savingVs2024);
  const derivedSaving = avg2024 !== null && price !== null ? avg2024 - price : null;
  const savingVs2024 = explicitSaving !== null ? explicitSaving : derivedSaving;

  const savingPctVs2024 =
    avg2024 !== null && avg2024 > 0 && savingVs2024 !== null
      ? roundToSingleDecimal((savingVs2024 / avg2024) * 100)
      : null;

  return {
    price,
    avg2024,
    savingVs2024,
    savingPctVs2024,
    travelScore: toBoundedScore(input.travelScore)
  };
}

