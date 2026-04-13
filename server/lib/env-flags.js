const TRUE_FLAG_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_FLAG_VALUES = new Set(['0', 'false', 'no', 'off']);

export function parseFlag(rawValue, fallback = false) {
  const text = String(rawValue ?? '')
    .trim()
    .toLowerCase();
  if (!text) return fallback;
  return TRUE_FLAG_VALUES.has(text);
}

export function parseBoolean(rawValue, fallback = false) {
  if (rawValue == null || rawValue === '') return fallback;
  if (typeof rawValue === 'boolean') return rawValue;
  const text = String(rawValue)
    .trim()
    .toLowerCase();
  if (TRUE_FLAG_VALUES.has(text)) return true;
  if (FALSE_FLAG_VALUES.has(text)) return false;
  return fallback;
}
