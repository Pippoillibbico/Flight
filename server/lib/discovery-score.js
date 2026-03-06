import { getCoverageGate } from './coverage-gate.js';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : NaN;
}

export function confidenceForCount(count) {
  const c = Math.max(0, Number(count) || 0);
  if (c >= 80) return { level: 'high', score: 0.95 };
  if (c >= 40) return { level: 'medium', score: 0.8 };
  if (c >= 25) return { level: 'low', score: 0.6 };
  return { level: 'very_low', score: 0.35 };
}

export function qualityGateForCount(count) {
  return getCoverageGate(count);
}

export function canonicalScoreFromPercentiles({ p10, p25, p50, p75, p90, observationCount, price, travelMonth }) {
  const px10 = toNumber(p10);
  const px25 = toNumber(p25);
  const px50 = toNumber(p50);
  const px75 = toNumber(p75);
  const px90 = toNumber(p90);
  const requestedPrice = toNumber(price);
  const safeCount = Math.max(0, Number(observationCount) || 0);
  const gate = qualityGateForCount(safeCount);

  const debug = {
    p10: Number.isFinite(px10) ? px10 : null,
    p25: Number.isFinite(px25) ? px25 : null,
    p50: Number.isFinite(px50) ? px50 : null,
    p75: Number.isFinite(px75) ? px75 : null,
    p90: Number.isFinite(px90) ? px90 : null,
    observationCount: safeCount,
    price: Number.isFinite(requestedPrice) ? requestedPrice : null,
    travelMonth: String(travelMonth || '')
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
      reasons: ['Not enough reliable baseline data yet.'],
      confidence: { level: 'very_low', score: 0.2, observationCount: 0 },
      visibility: 'hidden',
      debug
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
  const monthLabel = String(travelMonth || '').slice(0, 7) || 'unknown-month';
  const delta = Math.round(Math.abs(px50 - requestedPrice));
  const reasons = [
    `EUR ${delta} ${requestedPrice <= px50 ? 'below' : 'above'} median for ${monthLabel}`,
    `Typical range EUR ${Math.round(px10)}-${Math.round(px90)}`,
    `Confidence: ${confidence.level} (${safeCount} samples)`
  ];
  if (requestedPrice <= px10) reasons.push('Top 10% price for this route/month');
  else if (requestedPrice <= px25) reasons.push('Top 25% price for this route/month');
  else if (requestedPrice <= px50) reasons.push('Better than average for this route/month');
  if (gate.visibility === 'low_confidence') reasons.push('Limited data for this route/month');

  return {
    score,
    badge,
    reasons: reasons.slice(0, 5),
    confidence: {
      level: confidence.level,
      score: confidence.score,
      observationCount: safeCount
    },
    visibility: gate.visibility,
    debug
  };
}

export function legacyLevelFromBadge({ badge, price, p75 }) {
  const normalized = String(badge || '').toUpperCase();
  if (normalized === 'STEAL') return 'scream';
  if (normalized === 'GREAT') return 'great';
  if (normalized === 'GOOD') return 'good';
  return Number(price) <= Number(p75) ? 'fair' : 'bad';
}

export async function mapLimit(items, limit = 8, iteratee) {
  const safeItems = Array.isArray(items) ? items : [];
  const out = new Array(safeItems.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(Number(limit) || 8, safeItems.length || 1)) }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= safeItems.length) break;
      out[idx] = await iteratee(safeItems[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
