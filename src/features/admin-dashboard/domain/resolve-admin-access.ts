import type { AdminAccessContext, AdminAccessResult } from '../types/index.ts';

// No default allowlist — configure via VITE_ADMIN_ALLOWLIST_EMAILS in your environment.
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
  const allowlist = parseAllowlist(context?.allowlistCsv);
  return {
    isAdmin: Boolean(normalizedEmail && allowlist.includes(normalizedEmail)),
    normalizedEmail,
    allowlist
  };
}
