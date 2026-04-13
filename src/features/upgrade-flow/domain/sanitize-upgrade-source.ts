const SOURCE_MAX_LENGTH = 48;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function sanitizeUpgradeSource(value: unknown): string | undefined {
  const raw = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim();
  if (!raw) return undefined;
  if (EMAIL_PATTERN.test(raw)) return undefined;

  const normalized = raw
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_:-]/g, '')
    .trim();
  if (!normalized) return undefined;
  return normalized.slice(0, SOURCE_MAX_LENGTH);
}

