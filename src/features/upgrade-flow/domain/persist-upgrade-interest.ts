import type { UpgradePlanType } from '../types/index.ts';
import { sanitizeUpgradeSource } from './sanitize-upgrade-source.ts';
import { isConsentGiven } from '../../../utils/cookieConsent.js';
import { readLocalStorageItem, removeLocalStorageItem, writeLocalStorageItem } from '../../../utils/browserStorage.js';
import { UPGRADE_INTEREST_STORAGE_KEY } from '../../../utils/storageKeys.js';

interface UpgradeInterestRecord {
  planType: UpgradePlanType;
  source: string;
  submittedAt: string;
  userId: string | null;
}

const MAX_RECORDS = 30;
const MAX_STORAGE_RAW_LENGTH = 80_000;
const MAX_RECORD_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function createStableReference(value: string | null, prefix: string): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  const alreadyStablePattern = new RegExp(`^${prefix}_[a-z0-9]+$`);
  if (alreadyStablePattern.test(normalized)) return normalized;
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const unsigned = hash >>> 0;
  return `${prefix}_${unsigned.toString(36)}`;
}

function normalizeRecord(input: unknown): UpgradeInterestRecord | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const submittedAtRaw = String(record.submittedAt || '').trim();
  const submittedAt = new Date(submittedAtRaw);
  if (Number.isNaN(submittedAt.getTime())) return null;
  if (Date.now() - submittedAt.getTime() > MAX_RECORD_AGE_MS) return null;
  const planType = record.planType === 'elite' ? 'elite' : record.planType === 'pro' ? 'pro' : null;
  if (!planType) return null;
  const source = sanitizeUpgradeSource(record.source) || 'unknown';
  return {
    planType,
    source,
    submittedAt: submittedAt.toISOString(),
    userId: createStableReference(String(record.userId || ''), 'usr')
  };
}

function readRecords(raw: string | null): UpgradeInterestRecord[] {
  if (!raw) return [];
  if (raw.length > MAX_STORAGE_RAW_LENGTH) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRecord).filter((item): item is UpgradeInterestRecord => item !== null).slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

export function persistUpgradeInterest(
  planType: UpgradePlanType,
  source: string,
  userId: string | null,
  _userEmail: string | null = null
): UpgradeInterestRecord {
  const record: UpgradeInterestRecord = {
    planType,
    source: sanitizeUpgradeSource(source) || 'unknown',
    submittedAt: new Date().toISOString(),
    userId: createStableReference(userId, 'usr')
  };

  if (!isConsentGiven('functional')) {
    removeLocalStorageItem(UPGRADE_INTEREST_STORAGE_KEY);
    return record;
  }
  const existing = readRecords(readLocalStorageItem(UPGRADE_INTEREST_STORAGE_KEY));
  writeLocalStorageItem(UPGRADE_INTEREST_STORAGE_KEY, JSON.stringify([record, ...existing].slice(0, MAX_RECORDS)));

  return record;
}
