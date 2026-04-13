import { normalizeUserPlan } from './plan-entitlements.ts';
import type { UserPlan } from '../types/index.ts';
import { isConsentGiven } from '../../../utils/cookieConsent.js';
import { readLocalStorageItem, removeLocalStorageItem, writeLocalStorageItem } from '../../../utils/browserStorage.js';
import { USER_PLAN_STORAGE_KEY } from '../../../utils/storageKeys.js';
export { USER_PLAN_STORAGE_KEY };

const MAX_PLAN_STORAGE_RAW_LENGTH = 32;

function isAllowedPlanValue(value: string): boolean {
  return value === 'free' || value === 'pro' || value === 'elite';
}

export function readStoredUserPlan(): UserPlan {
  if (!isConsentGiven('functional')) {
    removeLocalStorageItem(USER_PLAN_STORAGE_KEY);
    return 'free';
  }
  const raw = readLocalStorageItem(USER_PLAN_STORAGE_KEY);
  if (!raw) return 'free';
  if (raw.length > MAX_PLAN_STORAGE_RAW_LENGTH) {
    removeLocalStorageItem(USER_PLAN_STORAGE_KEY);
    return 'free';
  }
  const rawNormalized = String(raw).trim().toLowerCase();
  const normalized = normalizeUserPlan(rawNormalized);
  if (!isAllowedPlanValue(rawNormalized)) {
    removeLocalStorageItem(USER_PLAN_STORAGE_KEY);
  }
  return normalized;
}

export function writeStoredUserPlan(plan: unknown): UserPlan {
  const normalized = normalizeUserPlan(plan);
  if (!isConsentGiven('functional')) {
    removeLocalStorageItem(USER_PLAN_STORAGE_KEY);
    return normalized;
  }
  writeLocalStorageItem(USER_PLAN_STORAGE_KEY, normalized);
  return normalized;
}
