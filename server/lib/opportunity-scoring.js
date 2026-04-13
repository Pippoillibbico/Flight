function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function scoreDestinationDesirability(routeMeta = {}) {
  const region = String(routeMeta.region || 'all').toLowerCase();
  const overtourismIndex = toNumber(routeMeta?.decisionMetadata?.overtourismIndex, 55);

  const regionBase =
    region === 'asia'
      ? 78
      : region === 'america'
      ? 74
      : region === 'oceania'
      ? 72
      : region === 'eu'
      ? 70
      : 66;

  // Lower overtourism gets a higher score for broader audience fit.
  const crowdingAdjustment = clamp((100 - overtourismIndex) * 0.24, -8, 14);
  return clamp(Math.round(regionBase + crowdingAdjustment), 35, 95);
}

function scoreStops(stopCount) {
  const stops = Math.max(0, Math.floor(toNumber(stopCount, 1)));
  if (stops === 0) return 100;
  if (stops === 1) return 78;
  if (stops === 2) return 56;
  return 38;
}

function scoreTripQuality(tripLengthDays) {
  const days = toNumber(tripLengthDays, 0);
  if (!Number.isFinite(days) || days <= 0) return 58;
  if (days >= 4 && days <= 10) return 92;
  if (days >= 3 && days <= 14) return 82;
  if (days >= 2 && days <= 18) return 72;
  return 54;
}

function scoreTravelPeriod(departDate, routeMeta = {}) {
  const month = Number(String(departDate || '').slice(5, 7));
  if (!Number.isFinite(month) || month < 1 || month > 12) return 62;
  const highSeason = new Set(routeMeta?.seasonality?.highSeasonMonths || []);
  const shoulder = new Set(routeMeta?.seasonality?.shoulderMonths || []);

  if (shoulder.has(month)) return 90;
  if (highSeason.has(month)) return 64;
  return 76;
}

function scoreItinerarySanity({ departDate, returnDate, tripLengthDays }) {
  const depart = new Date(departDate);
  if (Number.isNaN(depart.getTime())) return 42;
  if (!returnDate) return 68;

  const ret = new Date(returnDate);
  if (Number.isNaN(ret.getTime())) return 46;
  if (ret <= depart) return 24;

  const days = toNumber(tripLengthDays, 0);
  if (days >= 2 && days <= 21) return 94;
  if (days >= 1 && days <= 30) return 80;
  return 62;
}

function scoreDurationMinutes(durationMinutes) {
  const value = toNumber(durationMinutes, NaN);
  if (!Number.isFinite(value) || value <= 0) return 64;
  if (value <= 180) return 94;
  if (value <= 360) return 84;
  if (value <= 540) return 72;
  if (value <= 900) return 56;
  return 36;
}

function scoreDistance(distanceKm) {
  const value = toNumber(distanceKm, NaN);
  if (!Number.isFinite(value) || value <= 0) return 68;
  if (value <= 1200) return 90;
  if (value <= 2600) return 82;
  if (value <= 5200) return 72;
  if (value <= 9000) return 60;
  return 52;
}

function scoreAirlineQuality(airlineQualityScore) {
  const value = toNumber(airlineQualityScore, NaN);
  if (!Number.isFinite(value)) return 66;
  return clamp(Math.round(value), 20, 100);
}

function confidenceMultiplier(observationCount) {
  const count = Math.max(0, Math.floor(toNumber(observationCount, 0)));
  if (count >= 80) return 1;
  if (count >= 40) return 0.96;
  if (count >= 25) return 0.9;
  if (count >= 12) return 0.84;
  return 0.76;
}

export function scoreOpportunityCandidate({
  priceAttractiveness = 50,
  routeMeta = {},
  stopCount = 1,
  tripLengthDays = 0,
  travelDurationMinutes = null,
  distanceKm = null,
  airlineQualityScore = null,
  departDate = '',
  returnDate = '',
  observationCount = 0
}) {
  const components = {
    priceAttractiveness: clamp(Math.round(toNumber(priceAttractiveness, 50)), 0, 100),
    destinationDesirability: scoreDestinationDesirability(routeMeta),
    stops: scoreStops(stopCount),
    tripQuality: scoreTripQuality(tripLengthDays),
    duration: scoreDurationMinutes(travelDurationMinutes),
    distance: scoreDistance(distanceKm),
    airlineQuality: scoreAirlineQuality(airlineQualityScore),
    travelPeriod: scoreTravelPeriod(departDate, routeMeta),
    itinerarySanity: scoreItinerarySanity({ departDate, returnDate, tripLengthDays })
  };

  const rawScore = Math.round(
    components.priceAttractiveness * 0.36 +
      components.destinationDesirability * 0.12 +
      components.stops * 0.11 +
      components.tripQuality * 0.08 +
      components.duration * 0.1 +
      components.distance * 0.08 +
      components.airlineQuality * 0.07 +
      components.travelPeriod * 0.05 +
      components.itinerarySanity * 0.03
  );

  const multiplier = confidenceMultiplier(observationCount);
  const finalScore = clamp(Math.round(rawScore * multiplier), 0, 100);

  const opportunityLevel =
    finalScore >= 86
      ? 'Rare opportunity'
      : finalScore >= 75
      ? 'Exceptional price'
      : finalScore >= 62
      ? 'Great deal'
      : 'Ignore if too weak';

  return {
    rawScore,
    finalScore,
    opportunityLevel,
    components
  };
}
