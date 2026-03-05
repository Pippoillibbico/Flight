function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

/**
 * Deterministic weighted deal ranking in [0..100].
 * @param {{ priceDropPct?: number, rarity?: number, historicalPercentile?: number, destinationPopularity?: number }} input
 */
export function rankDeal({
  priceDropPct = 0,
  rarity = 0.5,
  historicalPercentile = 0.5,
  destinationPopularity = 0.5
}) {
  const dropComponent = clamp(Number(priceDropPct), 0, 80) / 80;
  const rarityComponent = clamp(Number(rarity), 0, 1);
  const percentileComponent = 1 - clamp(Number(historicalPercentile), 0, 1);
  const antiPopularity = 1 - clamp(Number(destinationPopularity), 0, 1);
  const score01 =
    dropComponent * 0.45 +
    rarityComponent * 0.25 +
    percentileComponent * 0.2 +
    antiPopularity * 0.1;
  return clamp(Math.round(score01 * 100), 0, 100);
}

/**
 * Deal type classifier based on drop percentiles/anomaly.
 * @param {{ dropPct?: number, belowP10?: boolean, anomaly?: boolean, belowP25?: boolean }} input
 */
export function inferDealType({ dropPct = 0, belowP10 = false, anomaly = false, belowP25 = false }) {
  if (anomaly && dropPct >= 45) return 'error_fare';
  if (belowP10 && dropPct >= 35) return 'flash_sale';
  if (belowP10 || belowP25) return 'hidden_deal';
  if (dropPct >= 18) return 'seasonal_drop';
  return 'normal';
}

/**
 * Scarcity/rarity score in [0..1] from sample characteristics.
 * @param {{ observationCount?: number, belowP10?: boolean, anomaly?: boolean }} input
 */
export function rarityFromSample({ observationCount = 0, belowP10 = false, anomaly = false }) {
  const count = Math.max(0, Number(observationCount) || 0);
  const scarcity = count <= 0 ? 1 : Math.min(1, 30 / count);
  const rarity = scarcity * 0.6 + (belowP10 ? 0.25 : 0) + (anomaly ? 0.15 : 0);
  return round2(Math.min(1, rarity));
}

/**
 * V2 ranking for proprietary local deal engine.
 * @param {{dealDelta:number,zRobust:number,comfortScore:number,seasonalityBonus:number,penalties:number,riskNote?:string}} input
 */
export function rankDealV2(input) {
  const delta = clamp(Number(input?.dealDelta || 0), -1, 1);
  const z = clamp(Number(input?.zRobust || 0), -3, 5);
  const comfort = clamp(Number(input?.comfortScore || 60), 1, 100) / 100;
  const season = clamp(Number(input?.seasonalityBonus || 0), -0.5, 0.5);
  const penalties = clamp(Number(input?.penalties || 0), 0, 0.8);

  const raw =
    0.45 * Math.max(0, delta) +
    0.25 * Math.max(0, z / 2) +
    0.2 * comfort +
    0.1 * Math.max(0, season) -
    penalties;

  const confidence = clamp(Math.round(raw * 100), 0, 100);
  return {
    dealConfidence: confidence,
    riskNote: String(input?.riskNote || ''),
    why: [
      delta >= 0.18 ? 'Prezzo sotto baseline del periodo.' : 'Prezzo vicino alla baseline.',
      z >= 1.2 ? 'Anomalia statistica favorevole.' : 'Anomalia moderata.',
      comfort >= 0.7 ? 'Comfort buono per tratta/finestra.' : 'Comfort medio o basso.'
    ]
  };
}
