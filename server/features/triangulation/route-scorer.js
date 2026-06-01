const RISK_ORDER = ['low', 'low_medium', 'medium', 'high'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bumpRisk(risk, steps = 1) {
  return RISK_ORDER[clamp(RISK_ORDER.indexOf(risk) + steps, 0, RISK_ORDER.length - 1)] || 'medium';
}

function reduceRisk(risk, steps = 1) {
  return RISK_ORDER[clamp(RISK_ORDER.indexOf(risk) - steps, 0, RISK_ORDER.length - 1)] || 'medium';
}

export function classifyTriangulationRisk({ separateTickets = true, layoverHours = 0, airportChange = false, baggage = 'personal_item', bridgeRisk = 'medium' } = {}) {
  let risk = bridgeRisk === 'low' || bridgeRisk === 'low_medium' ? bridgeRisk : 'medium';
  if (separateTickets && layoverHours < 4) risk = 'high';
  else if (separateTickets && layoverHours < 6) risk = baggage === 'checked' || airportChange ? 'high' : 'medium';
  else if (separateTickets && layoverHours >= 6) risk = bridgeRisk === 'low' ? 'low_medium' : 'medium';
  if (airportChange) risk = bumpRisk(risk);
  if (baggage === 'checked') risk = bumpRisk(risk);
  if (baggage === 'personal_item' && layoverHours >= 6 && !airportChange) risk = reduceRisk(risk);
  return risk;
}

export function buildTriangulationWarnings({ risk, layoverHours, separateTickets = true, airportChange = false, baggage = 'personal_item' } = {}) {
  const warnings = [];
  if (separateTickets) warnings.push('Biglietti separati: se il primo volo ritarda, il secondo non e protetto.');
  if (layoverHours < 6) warnings.push('Margine tra i voli sotto le 6 ore: rischio operativo piu alto.');
  if (airportChange) warnings.push('Cambio aeroporto: considera tempi di trasferimento, controlli e bagaglio.');
  if (baggage === 'checked') warnings.push('Bagaglio da stiva sconsigliato su self-transfer e biglietti separati.');
  if (baggage === 'personal_item') warnings.push('Consigliato per chi viaggia leggero con zaino o bagaglio a mano.');
  if (risk === 'high') warnings.push('Rischio alto: conviene solo con grande flessibilita o prezzo eccezionale.');
  return warnings;
}

export function scoreTriangulation({ baselinePrice, totalPrice, totalDurationHours = 28, layoverHours = 6, separateTickets = true, airportChange = false, baggage = 'personal_item', bridgeRisk = 'medium' } = {}) {
  const safeBaseline = Number(baselinePrice) > 0 ? Number(baselinePrice) : Number(totalPrice) || 1;
  const safeTotal = Number(totalPrice) > 0 ? Number(totalPrice) : safeBaseline;
  const saving = Math.max(0, safeBaseline - safeTotal);
  const savingPercent = safeBaseline > 0 ? (saving / safeBaseline) * 100 : 0;
  const risk = classifyTriangulationRisk({ separateTickets, layoverHours, airportChange, baggage, bridgeRisk });
  const riskScoreMap = { low: 100, low_medium: 82, medium: 62, high: 25 };
  const savingScore = clamp(savingPercent * 3.2, 0, 100);
  const riskScore = riskScoreMap[risk] || 55;
  const durationScore = clamp(110 - Number(totalDurationHours || 0) * 2.4, 0, 100);
  const baggageScore = baggage === 'personal_item' ? 100 : baggage === 'cabin_bag' ? 76 : 42;
  const comfortScore = clamp(100 - Math.abs(Number(layoverHours || 0) - 7) * 8 - (airportChange ? 22 : 0), 0, 100);
  const score = Math.round(savingScore * 0.4 + riskScore * 0.25 + durationScore * 0.15 + baggageScore * 0.1 + comfortScore * 0.1);
  return {
    savingVsBaseline: Math.round(saving),
    savingPercent: Math.round(savingPercent * 10) / 10,
    risk,
    score: clamp(score, 0, 100),
    warnings: buildTriangulationWarnings({ risk, layoverHours, separateTickets, airportChange, baggage })
  };
}
