import { getBridgeAirports } from './bridge-airports.js';

const DEFAULT_PREVIEW = Object.freeze([
  { route: 'ROM-BUD-BKK', label: 'Rome -> Budapest -> Bangkok', type: 'static_strategy', risk: 'medium', noteCode: 'CACHED_PREVIEW_STATIC', note: 'Indicative cached route strategy. Prices and availability are not live.' },
  { route: 'ROM-ATH-BKK', label: 'Rome -> Athens -> Bangkok', type: 'static_strategy', risk: 'medium', noteCode: 'CACHED_PREVIEW_STATIC', note: 'Indicative cached route strategy. Prices and availability are not live.' },
  { route: 'ROM-AUH-BKK', label: 'Rome -> Abu Dhabi -> Bangkok', type: 'static_strategy', risk: 'low_medium', noteCode: 'CACHED_PREVIEW_STATIC', note: 'Indicative cached route strategy. Prices and availability are not live.' }
]);

export function buildCachedTriangulationPreview(input = {}) {
  const origin = String(input.origin || '').trim().toUpperCase();
  const destination = String(input.destination || '').trim().toUpperCase();
  if (origin && destination) {
    const preview = getBridgeAirports({ origin, destination, max: 5 }).slice(0, 3).map((bridge) => ({
      route: `${origin}-${bridge.iata}-${destination}`,
      label: `${origin} -> ${bridge.city} -> ${destination}`,
      type: 'static_strategy',
      risk: bridge.riskProfile,
      noteCode: 'CACHED_PREVIEW_STATIC',
      note: `Indicative cached route strategy via ${bridge.city}. Prices and availability are not live.`
    }));
    if (preview.length) return preview;
  }
  return DEFAULT_PREVIEW.map((item) => ({ ...item }));
}

export function buildFreeTriangulationPayload(extra = {}) {
  return {
    mode: 'cached_preview',
    paidCostUsed: false,
    upgradeRequired: true,
    reason: 'triangulation_live_requires_paid_plan',
    messageCode: 'TRIANGULATION_LIVE_REQUIRES_PAID_PLAN',
    message:
      'Live triangulation, live AI, and updated provider prices require a paid plan. Free includes an indicative cached preview.',
    preview: buildCachedTriangulationPreview(extra),
    ...extra
  };
}
