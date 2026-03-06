import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SEED_ROUTES_PATH = fileURLToPath(new URL('../data/seed-routes.json', import.meta.url));

function isIata(value) {
  return /^[A-Z]{3}$/.test(String(value || '').trim().toUpperCase());
}

export async function loadSeedRoutes() {
  const raw = await readFile(SEED_ROUTES_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const origins = parsed?.origins && typeof parsed.origins === 'object' ? parsed.origins : {};
  const out = {};
  for (const [origin, destinations] of Object.entries(origins)) {
    const o = String(origin || '').trim().toUpperCase();
    if (!isIata(o) || !Array.isArray(destinations)) continue;
    out[o] = destinations
      .map((d) => String(d || '').trim().toUpperCase())
      .filter((d) => isIata(d) && d !== o);
  }
  return { origins: out };
}
