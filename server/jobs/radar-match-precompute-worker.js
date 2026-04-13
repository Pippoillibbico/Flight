import { listPublishedOpportunities } from '../lib/opportunity-store.js';
import { withDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';

function parseArray(value) {
  return Array.isArray(value) ? value : [];
}

function matchesRadar(opportunity, radar) {
  const origins = parseArray(radar.originAirports).map((x) => String(x).toUpperCase());
  const destinationHints = parseArray(radar.favoriteDestinations).map((x) => String(x).toLowerCase());
  const countries = parseArray(radar.favoriteCountries).map((x) => String(x).toLowerCase());
  const months = parseArray(radar.preferredTravelMonths).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x >= 1 && x <= 12);
  const budget = Number(radar.budgetCeiling);

  if (origins.length > 0 && !origins.includes(String(opportunity.origin_airport || '').toUpperCase())) return false;
  if (Number.isFinite(budget) && budget > 0 && Number(opportunity.price || 0) > budget) return false;
  if (months.length > 0) {
    const month = Number(String(opportunity.depart_date || '').slice(5, 7));
    if (!months.includes(month)) return false;
  }
  if (destinationHints.length > 0) {
    const haystack = `${opportunity.destination_city} ${opportunity.destination_airport}`.toLowerCase();
    const ok = destinationHints.some((hint) => haystack.includes(hint));
    if (!ok) return false;
  }
  if (countries.length > 0) {
    const haystack = `${opportunity.destination_country || ''} ${opportunity.destination_city || ''} ${opportunity.destination_airport || ''}`.toLowerCase();
    const ok = countries.some((hint) => haystack.includes(hint));
    if (!ok) return false;
  }
  return true;
}

export async function runRadarMatchPrecomputeOnce({ perUserLimit = 25 } = {}) {
  const opportunities = await listPublishedOpportunities({ limit: 120 });
  let processedUsers = 0;
  let totalMatches = 0;
  const safeLimit = Math.max(1, Math.min(100, Number(perUserLimit) || 25));

  await withDb(async (db) => {
    const radars = parseArray(db.radarPreferences);
    db.radarMatchSnapshots = parseArray(db.radarMatchSnapshots).filter((item) => {
      const ts = new Date(item.createdAt || 0).getTime();
      return Number.isFinite(ts) && Date.now() - ts < 48 * 3600 * 1000;
    });

    for (const radar of radars) {
      processedUsers += 1;
      const matches = opportunities.filter((item) => matchesRadar(item, radar)).slice(0, safeLimit);
      totalMatches += matches.length;
      db.radarMatchSnapshots.push({
        id: `radar_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
        userId: radar.userId,
        radarId: radar.id,
        createdAt: new Date().toISOString(),
        totalMatches: matches.length,
        opportunityIds: matches.map((item) => item.id)
      });
    }
    db.radarMatchSnapshots = db.radarMatchSnapshots.slice(-3000);
    return db;
  });

  logger.info({ processedUsers, totalMatches }, 'radar_match_precompute_worker_completed');
  return { processedUsers, totalMatches };
}
