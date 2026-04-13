export type ConsentCategory = 'necessary' | 'functional' | 'analytics';

export interface ConsentRecord {
  functional: boolean;
  analytics: boolean;
  version: number;
  ts: number;
}

export interface ConsentStorageEnforcementResult {
  removedKeys: string[];
  failedKeys: string[];
}

export function acceptAllConsent(): ConsentRecord | null;
export function rejectOptionalConsent(): ConsentRecord | null;
export function acceptFunctionalOnly(): ConsentRecord | null;
export function saveConsentPreferences(prefs?: { functional?: boolean; analytics?: boolean }): ConsentRecord | null;
export function hasConsented(): boolean;
export function isConsentGiven(category: ConsentCategory): boolean;
export function getConsentSnapshot(): ConsentRecord | null;
export function clearConsent(): void;
export function enforceConsentStoragePolicy(record?: ConsentRecord | null): ConsentStorageEnforcementResult;
export function bootstrapConsentPolicy(): ConsentStorageEnforcementResult;

export const FUNCTIONAL_STORAGE_KEYS: string[];
export const ANALYTICS_STORAGE_KEYS: string[];
export const CONSENT_KEY: string;
