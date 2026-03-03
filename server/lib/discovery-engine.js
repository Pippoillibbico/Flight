import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getOrCreateSubscription } from './saas-db.js';
import { listRouteBaselinesForOrigin, scoreDeal } from './deal-engine-store.js';

const SEASON_MAP_PATH = fileURLToPath(new URL('../data/discovery-season-map.json', import.meta.url));

let cachedSeasonMap = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toDateOnly(text) {
  const v = String(text || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Invalid date. Expected YYYY-MM-DD.');
  return v;
}

function seasonForDate(dateText) {
  const month = Number(String(dateText).slice(5, 7));
  if ([12, 1, 2].includes(month)) return 'winter';
  if ([3, 4, 5].includes(month)) return 'spring';
  if ([6, 7, 8].includes(month)) return 'summer';
  return 'autumn';
}

function monthStart(dateText) {
  return `${String(dateText).slice(0, 7)}-01`;
}

function monthEnd(dateText) {
  const y = Number(String(dateText).slice(0, 4));
  const m = Number(String(dateText).slice(5, 7));
  const end = new Date(Date.UTC(y, m, 0));
  const yyyy = end.getUTCFullYear();
  const mm = String(end.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(end.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function loadSeasonMap() {
  if (cachedSeasonMap) return cachedSeasonMap;
  const raw = await readFile(SEASON_MAP_PATH, 'utf8');
  cachedSeasonMap = JSON.parse(raw);
  return cachedSeasonMap;
}

export async function getDestinationMeta(destinationIata) {
  const map = await loadSeasonMap();
  const code = String(destinationIata || '').trim().toUpperCase();
  return map.destinations?.[code] || null;
}

function seasonScore(meta, { season, mood, region }) {
  const defaults = cachedSeasonMap?.defaults || {};
  const seasonBoost = Number(meta?.seasonBoost?.[season] ?? defaults.seasonBoost?.[season] ?? 1);
  const moodBoost = Number(meta?.moodBoost?.[mood] ?? defaults.moodBoost?.[mood] ?? 1);
  const regionMatch = region === 'all' || region === String(meta?.region || defaults.region || 'all');
  const regionBoost = regionMatch ? 1 : 0.82;
  return Math.round(clamp(seasonBoost * moodBoost * regionBoost * 100, 0, 100));
}

function packageCountForPlan(planId) {
  return planId === 'free' ? 3 : 4;
}

export async function runDiscoveryJustGo({ userId, origin, budget, mood, region, dateFrom, dateTo }) {
  const originIata = String(origin || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(originIata)) throw new Error('Invalid origin IATA code.');
  const budgetEur = Number(budget);
  if (!Number.isFinite(budgetEur) || budgetEur <= 0) throw new Error('Invalid budget.');

  const safeMood = String(mood || 'relax').trim().toLowerCase();
  const safeRegion = String(region || 'all').trim().toLowerCase();
  const fromDate = toDateOnly(dateFrom);
  const toDate = toDateOnly(dateTo);
  if (toDate < fromDate) throw new Error('Invalid date window.');
  const fromMonth = monthStart(fromDate);
  const toMonth = monthEnd(toDate);

  const sub = await getOrCreateSubscription(userId);
  const packageCount = packageCountForPlan(sub.planId);
  await loadSeasonMap();
  const season = seasonForDate(fromDate);

  const rows = await listRouteBaselinesForOrigin({ originIata, fromMonth, toMonth });
  const ranked = [];
  for (const row of rows) {
    const destination = String(row.destination_iata || '').toUpperCase();
    const meta = await getDestinationMeta(destination);
    if (safeRegion !== 'all' && meta?.region && meta.region !== safeRegion) continue;

    const travelMonth = String(row.travel_month).slice(0, 10);
    const deal = await scoreDeal({
      origin: originIata,
      destination,
      departureDate: travelMonth,
      price: budgetEur
    });
    const weatherFit = seasonScore(meta, { season, mood: safeMood, region: safeRegion });
    const composite = Math.round(deal.dealScore * 0.72 + weatherFit * 0.28);
    ranked.push({
      destinationIata: destination,
      region: meta?.region || 'all',
      travelMonth,
      estimatedPrice: Number(row.p50_price),
      dealLevel: deal.dealLevel,
      dealScore: deal.dealScore,
      confidence: deal.confidence,
      seasonScore: weatherFit,
      rankScore: composite,
      why: deal.why
    });
  }

  ranked.sort((a, b) => b.rankScore - a.rankScore || b.dealScore - a.dealScore || a.estimatedPrice - b.estimatedPrice);

  return {
    mode: sub.planId === 'free' ? 'free' : 'paid',
    ai_included: false,
    ai_message: 'AI not included in free plan.',
    packageCount,
    items: ranked.slice(0, packageCount)
  };
}
