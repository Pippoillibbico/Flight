/**
 * @typedef {Object} AnomalyInput
 * @property {number} price
 * @property {number} baselineP50
 * @property {number} baselineP25
 * @property {number} baselineP75
 * @property {number=} stopCount
 * @property {boolean=} avoidNight
 * @property {boolean=} isNightFlight
 * @property {number=} comfortScore
 */

function n(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

/**
 * Computes local deal anomaly signal from baseline quantiles and comfort heuristics.
 * Deal rule: delta>=0.18 OR z_robust>=1.2 (after penalties).
 * @param {AnomalyInput} input
 */
export function detectPriceAnomaly(input) {
  const price = n(input?.price, 0);
  const p50 = Math.max(1, n(input?.baselineP50, 1));
  const p25 = Math.max(1, n(input?.baselineP25, p50 * 0.85));
  const p75 = Math.max(p25 + 1, n(input?.baselineP75, p50 * 1.15));
  const epsilon = 1e-6;

  const rawDealDelta = (p50 - price) / p50;
  const rawZ = (p50 - price) / (p75 - p25 + epsilon);

  let penalty = 0;
  const stopCount = Math.max(0, Math.floor(n(input?.stopCount, 0)));
  if (stopCount >= 1) penalty += 0.04;
  if (stopCount >= 2) penalty += 0.05;
  if (Boolean(input?.avoidNight) && Boolean(input?.isNightFlight)) penalty += 0.05;
  const comfort = n(input?.comfortScore, 70);
  if (comfort < 55) penalty += 0.05;

  const dealDelta = rawDealDelta - penalty;
  const zRobust = rawZ - penalty * 4;
  const isDeal = dealDelta >= 0.18 || zRobust >= 1.2;

  return {
    isDeal,
    dealDelta: Number(dealDelta.toFixed(4)),
    zRobust: Number(zRobust.toFixed(4)),
    rawDealDelta: Number(rawDealDelta.toFixed(4)),
    rawZRobust: Number(rawZ.toFixed(4)),
    penalty: Number(penalty.toFixed(4))
  };
}
