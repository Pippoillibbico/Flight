import type { AdminAccessContext, AdminAccessResult } from '../types/index.ts';

const DEFAULT_ALLOWLIST: string[] = [];

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function parseAllowlist(rawCsv?: string | null): string[] {
  const csv = String(rawCsv || '').trim();
  const base = csv
    .split(',')
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
  if (base.length > 0) return Array.from(new Set(base));
  return [...DEFAULT_ALLOWLIST];
}

export function resolveAdminAccess(context: AdminAccessContext): AdminAccessResult {
  const normalizedEmail = normalizeEmail(context?.userEmail);
  const serverAdmin = context?.isServerAdmin === true;
  const allowlist = parseAllowlist(context?.allowlistCsv);
  return {
    isAdmin: serverAdmin || Boolean(normalizedEmail && allowlist.includes(normalizedEmail)),
    normalizedEmail,
    allowlist
  };
}
