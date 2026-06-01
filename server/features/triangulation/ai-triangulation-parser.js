import { triangulationSearchSchema } from './triangulation.schema.js';

function nextJuneMonth(now = new Date()) {
  const year = now.getUTCMonth() >= 5 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return `${year}-06`;
}

function inferDestination(prompt) {
  const text = prompt.toLowerCase();
  if (text.includes('bangkok')) return { destination: 'BKK', destinationArea: 'bangkok' };
  if (text.includes('thailand') || text.includes('tailandia')) return { destination: 'BKK', destinationArea: 'thailand' };
  if (text.includes('sud-est asiatico') || text.includes('south-east asia') || text.includes('southeast asia')) {
    return { destination: 'BKK', destinationArea: 'south_east_asia' };
  }
  return { destination: 'BKK', destinationArea: 'bangkok' };
}

export function deterministicParseTriangulationPrompt({ prompt, baggage = 'personal_item', riskTolerance = 'medium' } = {}) {
  const text = String(prompt || '').toLowerCase();
  const origin = text.includes('milano') || text.includes('milan') ? 'MIL' : 'ROM';
  const destination = inferDestination(text);
  const month = text.includes('giugno') || text.includes('june') ? nextJuneMonth() : nextJuneMonth();
  return triangulationSearchSchema.parse({
    origin,
    ...destination,
    period: { type: 'month', month },
    flexibility: text.includes('quando vuoi') || text.includes('mese') || text.includes('month') ? 'full_month' : 'flexible_dates',
    goal: 'lowest_price',
    strategy: 'triangulation',
    maxBridgeStops: 2,
    baggage,
    riskTolerance,
    travellers: 1,
    cabinClass: 'economy'
  });
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {}
  }
  return null;
}

export async function parseTriangulationPrompt({ prompt, aiProvider = 'auto', baggage = 'personal_item', riskTolerance = 'medium', aiRunner = null } = {}) {
  if (typeof aiRunner === 'function' && aiProvider !== 'none') {
    const aiResponse = await aiRunner({
      task: 'triangulation_parse',
      aiProvider,
      prompt:
        'Converti la richiesta utente in parametri strutturati per una ricerca voli. Non inventare prezzi, voli o disponibilita. Se un dato manca, usa default sicuri.',
      input: { prompt, baggage, riskTolerance }
    });
    const parsedJson = extractJsonObject(aiResponse);
    const parsed = triangulationSearchSchema.safeParse(parsedJson);
    if (parsed.success) return { parsed: parsed.data, source: 'ai' };
  }

  return {
    parsed: deterministicParseTriangulationPrompt({ prompt, baggage, riskTolerance }),
    source: 'deterministic_fallback'
  };
}
