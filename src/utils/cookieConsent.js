/**
 * Cookie consent management.
 *
 * Categories:
 *  - necessary  : always on
 *  - functional : local preferences/state persistence
 *  - analytics  : telemetry/funnel tracking
 *
 * The consent record itself is necessary to remember the user's choice.
 */

import {
  CONSENT_STORAGE_KEY,
  FUNCTIONAL_LOCAL_STORAGE_KEYS,
  ANALYTICS_LOCAL_STORAGE_KEYS
} from './storageKeys.js';

const CONSENT_KEY = CONSENT_STORAGE_KEY;
const CONSENT_VERSION = 2;
const LEGACY_CONSENT_VERSION = 1;
const SUPPORTED_CONSENT_VERSIONS = new Set([LEGACY_CONSENT_VERSION, CONSENT_VERSION]);

const FUNCTIONAL_STORAGE_KEYS = [...FUNCTIONAL_LOCAL_STORAGE_KEYS];
const ANALYTICS_STORAGE_KEYS = [...ANALYTICS_LOCAL_STORAGE_KEYS];

/** @typedef {'necessary' | 'functional' | 'analytics'} ConsentCategory */
/** @typedef {{ functional: boolean, analytics: boolean, version: number, ts: number }} ConsentRecord */

/** @returns {Storage | null} */
function getStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** @returns {ConsentRecord | null} */
function normalizeConsentRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const version = Number(record.version);
  if (!SUPPORTED_CONSENT_VERSIONS.has(version)) return null;
  return {
    functional: Boolean(record.functional),
    analytics: Boolean(record.analytics),
    version: CONSENT_VERSION,
    ts: Number.isFinite(Number(record.ts)) ? Number(record.ts) : Date.now()
  };
}

/** @returns {ConsentRecord | null} */
function readConsent() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const normalized = normalizeConsentRecord(parsed);
    if (!normalized) return null;
    // Seamless migration: keep existing consent choice while upgrading schema shape/version.
    if (Number(parsed?.version) !== CONSENT_VERSION) {
      try {
        storage.setItem(CONSENT_KEY, JSON.stringify(normalized));
      } catch {
        // ignore write failures and return normalized in-memory snapshot
      }
    }
    return normalized;
  } catch {
    return null;
  }
}

function emitConsentChanged(detail) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('flight_consent_changed', { detail }));
  } catch {
    // ignore browser event restrictions
  }
}

/**
 * Remove storage keys that are not allowed by the current consent.
 * @param {ConsentRecord | null} record
 */
export function enforceConsentStoragePolicy(record = readConsent()) {
  const storage = getStorage();
  if (!storage) return { removedKeys: [], failedKeys: [] };
  const removedKeys = [];
  const failedKeys = [];
  const functionalAllowed = Boolean(record?.functional);
  const analyticsAllowed = Boolean(record?.analytics);
  const keysToRemove = [
    ...(functionalAllowed ? [] : FUNCTIONAL_STORAGE_KEYS),
    ...(analyticsAllowed ? [] : ANALYTICS_STORAGE_KEYS)
  ];
  for (const key of keysToRemove) {
    try {
      storage.removeItem(key);
      removedKeys.push(key);
    } catch {
      failedKeys.push(key);
    }
  }
  return { removedKeys, failedKeys };
}

/** @param {Partial<ConsentRecord>} prefs */
function writeConsent(prefs) {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const record = {
      functional: Boolean(prefs.functional),
      analytics: Boolean(prefs.analytics),
      version: CONSENT_VERSION,
      ts: Date.now()
    };
    storage.setItem(CONSENT_KEY, JSON.stringify(record));
    enforceConsentStoragePolicy(record);
    emitConsentChanged(record);
    return record;
  } catch {
    return null;
  }
}

/** Accept all categories (except necessary which is always on). */
export function acceptAllConsent() {
  return writeConsent({ functional: true, analytics: true });
}

/** Accept only strictly necessary cookies/storage. */
export function rejectOptionalConsent() {
  return writeConsent({ functional: false, analytics: false });
}

/** Accept necessary + functional, reject analytics. */
export function acceptFunctionalOnly() {
  return writeConsent({ functional: true, analytics: false });
}

/** Persist explicit preferences (used by "customize" actions). */
export function saveConsentPreferences({ functional = false, analytics = false } = {}) {
  return writeConsent({ functional: Boolean(functional), analytics: Boolean(analytics) });
}

/** Has the user made an explicit consent choice? */
export function hasConsented() {
  return readConsent() !== null;
}

/** Is a given category permitted? */
export function isConsentGiven(category) {
  if (category === 'necessary') return true;
  const record = readConsent();
  if (!record) return false;
  return Boolean(record[category]);
}

/** Return current consent snapshot (or null if user never chose). */
export function getConsentSnapshot() {
  return readConsent();
}

/** Wipe consent state (e.g. account deletion / forget-me). */
export function clearConsent() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(CONSENT_KEY);
    enforceConsentStoragePolicy(null);
    emitConsentChanged(null);
  } catch {
    // ignore
  }
}

/** Run once at app boot to remove stale disallowed storage keys. */
export function bootstrapConsentPolicy() {
  const record = readConsent();
  return enforceConsentStoragePolicy(record);
}

export {
  readConsent,
  FUNCTIONAL_STORAGE_KEYS,
  ANALYTICS_STORAGE_KEYS,
  CONSENT_KEY
};
