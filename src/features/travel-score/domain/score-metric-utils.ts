function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizePenalty(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 1;
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

export function clampScore(value: number): number {
  return clamp(value, 0, 100);
}
