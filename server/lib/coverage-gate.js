export function getCoverageGate(observationCount) {
  const count = Math.max(0, Number(observationCount) || 0);
  if (count >= 40) return { allowed: true, visibility: 'normal' };
  if (count >= 25) return { allowed: true, visibility: 'low_confidence' };
  return { allowed: false, visibility: 'hidden' };
}
