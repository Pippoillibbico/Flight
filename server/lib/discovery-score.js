function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function n(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : NaN;
}

export function confidenceForCount(count) {
  const c = Math.max(0, Number(count) || 0);
  if (c >= 80) return { level: 'high', score: 0.95 };
  if (c >= 40) return { level: 'medium', score: 0.8 };
  if (c >= 15) return { level: 'low', score: 0.6 };
  return { level: 'very_low', score: 0.35 };
}

export function legacyLevelFromBadge({ badge, price, p75 }) {
  const b = String(badge || '').toUpperCase();
  if (b === 'STEAL') return 'scream';
  if (b === 'GREAT') return 'great';
  if (b === 'GOOD') return 'good';
  return Number(price) <= Number(p75) ? 'fair' : 'bad';
}

export function canonicalScoreFromPercentiles({ p10, p25, p50, p75, p90, observationCount, price, travelMonth }) {
  const px10 = n(p10);
  const px25 = n(p25);
  const px50 = n(p50);
  const px75 = n(p75);
  const px90 = n(p90);
  const requestedPrice = n(price);
  const safeCount = Math.max(0, Number(observationCount) || 0);
  const debugBase = {
    p10: Number.isFinite(px10) ? px10 : null,
    p25: Number.isFinite(px25) ? px25 : null,
    p50: Number.isFinite(px50) ? px50 : null,
    p75: Number.isFinite(px75) ? px75 : null,
    p90: Number.isFinite(px90) ? px90 : null,
    travelMonth: String(travelMonth || ''),
    price: Number.isFinite(requestedPrice) ? requestedPrice : null
  };

  if (
    !Number.isFinite(px10) ||
    !Number.isFinite(px25) ||
    !Number.isFinite(px50) ||
    !Number.isFinite(px75) ||
    !Number.isFinite(px90) ||
    !Number.isFinite(requestedPrice) ||
    px90 <= px10
  ) {
    return {
      score: 50,
      badge: 'OK',
      reasons: ['Not enough baseline data yet.', 'Typical range unavailable.', 'Confidence: very_low (0 samples)'],
      confidence: { level: 'very_low', score: 0.2, observationCount: 0 },
      debug: debugBase
    };
  }

  const safeRange = Math.max(1, px90 - px10);
  const normalized = clamp((px90 - requestedPrice) / safeRange, 0, 1);
  const score = Math.round(normalized * 100);
  let badge = 'OK';
  if (requestedPrice <= px10) badge = 'STEAL';
  else if (requestedPrice <= px25) badge = 'GREAT';
  else if (requestedPrice <= px50) badge = 'GOOD';

  const confidence = confidenceForCount(safeCount);
  const delta = Math.round((px50 - requestedPrice) * 100) / 100;
  const below = delta >= 0;
  const reasons = [
    `EUR ${Math.abs(delta).toFixed(2)} ${below ? 'below' : 'above'} the median for ${String(travelMonth).slice(0, 7)}.`,
    `Typical range EUR ${Math.round(px10)}-EUR ${Math.round(px90)}.`,
    `Confidence: ${confidence.level} (${safeCount} samples).`
  ];
  if (requestedPrice <= px10) reasons.push('Top 10% price for this route/month.');
  else if (requestedPrice <= px25) reasons.push('Top 25% price for this route/month.');
  else if (requestedPrice <= px50) reasons.push('Better than average for this route/month.');

  return {
    score,
    badge,
    reasons: reasons.slice(0, 5),
    confidence: {
      level: confidence.level,
      score: confidence.score,
      observationCount: safeCount
    },
    debug: debugBase
  };
}
