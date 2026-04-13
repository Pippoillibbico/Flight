export function parseCookieHeader(rawHeader) {
  const parsed = {};
  const source = String(rawHeader || '');
  if (!source) return parsed;

  for (const part of source.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    const key = String(rawKey || '').trim();
    if (!key) continue;
    const rawValue = rest.join('=');
    try {
      parsed[key] = decodeURIComponent(rawValue || '');
    } catch {
      parsed[key] = rawValue || '';
    }
  }

  return parsed;
}
