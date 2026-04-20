import { isConsentGiven } from '../../utils/cookieConsent.js';
import { readLocalStorageItem, removeLocalStorageItem, writeLocalStorageItem } from '../../utils/browserStorage.js';
import {
  REMEMBERED_EMAIL_STORAGE_KEY,
  TRACKED_ROUTES_STORAGE_KEY,
  SAVED_ITINERARIES_STORAGE_KEY,
  RADAR_SESSION_ACTIVE_STORAGE_KEY,
  USER_PLAN_STORAGE_KEY,
  UPGRADE_INTEREST_STORAGE_KEY,
  POST_AUTH_ACTION_STORAGE_KEY,
  POST_AUTH_MODE_STORAGE_KEY,
  POST_AUTH_VIEW_STORAGE_KEY,
  POST_AUTH_SECTION_STORAGE_KEY
} from '../../utils/storageKeys.js';

export {
  REMEMBERED_EMAIL_STORAGE_KEY,
  TRACKED_ROUTES_STORAGE_KEY,
  SAVED_ITINERARIES_STORAGE_KEY,
  RADAR_SESSION_ACTIVE_STORAGE_KEY,
  USER_PLAN_STORAGE_KEY,
  UPGRADE_INTEREST_STORAGE_KEY,
  POST_AUTH_ACTION_STORAGE_KEY,
  POST_AUTH_MODE_STORAGE_KEY,
  POST_AUTH_VIEW_STORAGE_KEY,
  POST_AUTH_SECTION_STORAGE_KEY
};
export const PERSONAL_HUB_STORAGE_EVENT = 'flight_personal_hub_storage_updated';
const MAX_STORAGE_VALUE_LENGTH = 120_000;
const MAX_REMEMBERED_EMAIL_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_UPGRADE_INTEREST_RECORDS = 30;

const BASE_TRAVEL_STORAGE_KEYS = [
  TRACKED_ROUTES_STORAGE_KEY,
  SAVED_ITINERARIES_STORAGE_KEY,
  RADAR_SESSION_ACTIVE_STORAGE_KEY,
  USER_PLAN_STORAGE_KEY,
  UPGRADE_INTEREST_STORAGE_KEY
];

const ACCOUNT_HINT_STORAGE_KEYS = [
  REMEMBERED_EMAIL_STORAGE_KEY,
  POST_AUTH_ACTION_STORAGE_KEY,
  POST_AUTH_MODE_STORAGE_KEY,
  POST_AUTH_VIEW_STORAGE_KEY,
  POST_AUTH_SECTION_STORAGE_KEY
];

export const LOCAL_TRAVEL_STORAGE_KEYS = [...BASE_TRAVEL_STORAGE_KEYS];

function emitPersonalHubStorageChanged(changedKey) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(PERSONAL_HUB_STORAGE_EVENT, {
        detail: { changedKey: String(changedKey || '') }
      })
    );
  } catch {
    // ignore event restrictions
  }
}

function safeParseJson(raw, fallbackValue) {
  const serialized = String(raw || '');
  if (serialized.length > MAX_STORAGE_VALUE_LENGTH) return fallbackValue;
  try {
    return JSON.parse(serialized);
  } catch {
    return fallbackValue;
  }
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePlanType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'pro' || normalized === 'elite') return normalized;
  return 'free';
}

function looksLikeEmail(value) {
  const text = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

function readTrimmedStorageValue(key, maxLength) {
  return String(readLocalStorageItem(key) || '')
    .trim()
    .slice(0, maxLength);
}

function readRememberedEmailPayload() {
  if (typeof window === 'undefined') return null;
  const raw = readLocalStorageItem(REMEMBERED_EMAIL_STORAGE_KEY);
  if (!raw) return null;
  if (raw.length > 2048) return null;
  const parsed = safeParseJson(raw, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const email = String(parsed.email || '').trim();
    const savedAt = String(parsed.savedAt || '').trim();
    const savedAtDate = new Date(savedAt);
    if (!looksLikeEmail(email) || Number.isNaN(savedAtDate.getTime())) return null;
    if (Date.now() - savedAtDate.getTime() > MAX_REMEMBERED_EMAIL_AGE_MS) return null;
    return {
      email,
      savedAt: savedAtDate.toISOString()
    };
  }
  const legacyEmail = String(raw || '').trim();
  if (!looksLikeEmail(legacyEmail)) return null;
  return {
    email: legacyEmail,
    savedAt: new Date().toISOString()
  };
}

function readUpgradeInterestRecords() {
  if (typeof window === 'undefined') return [];
  if (!isConsentGiven('functional')) return [];
  const raw = readLocalStorageItem(UPGRADE_INTEREST_STORAGE_KEY);
  if (!raw) return [];
  const parsed = safeParseJson(raw, []);
  if (!Array.isArray(parsed)) return [];
  const nowMs = Date.now();
  return parsed
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const planType = normalizePlanType(item.planType);
      const source = String(item.source || '').trim().slice(0, 64) || 'unknown';
      const submittedAtRaw = String(item.submittedAt || '').trim();
      const submittedAtDate = new Date(submittedAtRaw);
      if (Number.isNaN(submittedAtDate.getTime())) return null;
      if (nowMs - submittedAtDate.getTime() > 90 * 24 * 60 * 60 * 1000) return null;
      const userId = String(item.userId || '').trim().slice(0, 48) || null;
      return {
        planType,
        source,
        submittedAt: submittedAtDate.toISOString(),
        userId: userId || null
      };
    })
    .filter(Boolean)
    .slice(0, MAX_UPGRADE_INTEREST_RECORDS);
}

export function readRememberedEmail() {
  if (typeof window === 'undefined') return '';
  // Only read if functional cookies are consented — avoids surfacing PII without consent.
  if (!isConsentGiven('functional')) return '';
  const payload = readRememberedEmailPayload();
  if (!payload) {
    removeLocalStorageItem(REMEMBERED_EMAIL_STORAGE_KEY);
    return '';
  }
  writeLocalStorageItem(REMEMBERED_EMAIL_STORAGE_KEY, JSON.stringify(payload));
  return payload.email;
}

export function writeRememberedEmail(value) {
  if (typeof window === 'undefined') return '';
  // Only persist if user has consented to functional cookies (GDPR Art. 7).
  if (!isConsentGiven('functional')) return '';
  const email = String(value || '').trim();
  if (!looksLikeEmail(email)) {
    clearRememberedEmail();
    return '';
  }
  const payload = {
    email,
    savedAt: new Date().toISOString()
  };
  writeLocalStorageItem(REMEMBERED_EMAIL_STORAGE_KEY, JSON.stringify(payload));
  return email;
}

export function clearRememberedEmail() {
  if (typeof window === 'undefined') return;
  removeLocalStorageItem(REMEMBERED_EMAIL_STORAGE_KEY);
}

export function readTrackedRouteSlugs() {
  if (typeof window === 'undefined') return [];
  if (!isConsentGiven('functional')) return [];
  const raw = readLocalStorageItem(TRACKED_ROUTES_STORAGE_KEY);
  if (!raw) return [];
  const parsed = safeParseJson(raw, []);
  if (!Array.isArray(parsed)) return [];
  return Array.from(new Set(parsed.map(normalizeSlug).filter(Boolean)));
}

export function writeTrackedRouteSlugs(values) {
  if (typeof window === 'undefined') return [];
  const normalized = Array.from(
    new Set(
      Array.from(values || [])
        .map(normalizeSlug)
        .filter(Boolean)
    )
  ).sort();
  if (!isConsentGiven('functional')) {
    removeLocalStorageItem(TRACKED_ROUTES_STORAGE_KEY);
    emitPersonalHubStorageChanged(TRACKED_ROUTES_STORAGE_KEY);
    return normalized;
  }
  writeLocalStorageItem(TRACKED_ROUTES_STORAGE_KEY, JSON.stringify(normalized));
  emitPersonalHubStorageChanged(TRACKED_ROUTES_STORAGE_KEY);
  return normalized;
}

export function removeTrackedRouteSlug(slug) {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) return readTrackedRouteSlugs();
  const next = readTrackedRouteSlugs().filter((value) => value !== normalizedSlug);
  return writeTrackedRouteSlugs(next);
}

function normalizeSavedItineraryEntry(entry) {
  const itineraryId = String(entry?.itineraryId || '').trim();
  const key = String(entry?.key || itineraryId || '').trim();
  if (!key) return null;
  const routeLabel = String(entry?.routeLabel || '').trim();
  const label = String(entry?.label || 'Recently viewed').trim() || 'Recently viewed';
  const currency = String(entry?.currency || 'EUR').trim().toUpperCase() || 'EUR';
  const priceValue = Number(entry?.price);
  const price = Number.isFinite(priceValue) ? Math.round(priceValue) : null;
  const savedAtRaw = String(entry?.savedAt || '');
  const savedAtDate = new Date(savedAtRaw);
  const savedAt = Number.isNaN(savedAtDate.getTime()) ? new Date().toISOString() : savedAtDate.toISOString();
  return {
    key,
    itineraryId: itineraryId || null,
    routeLabel: routeLabel || key,
    price,
    currency,
    label,
    savedAt
  };
}

export function readSavedItineraries() {
  if (typeof window === 'undefined') return [];
  if (!isConsentGiven('functional')) return [];
  const raw = readLocalStorageItem(SAVED_ITINERARIES_STORAGE_KEY);
  if (!raw) return [];
  const parsed = safeParseJson(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(normalizeSavedItineraryEntry)
    .filter(Boolean)
    .slice(0, 200);
}

function writeSavedItineraries(values) {
  if (typeof window === 'undefined') return [];
  const normalized = Array.from(values || [])
    .map(normalizeSavedItineraryEntry)
    .filter(Boolean);
  if (!isConsentGiven('functional')) {
    removeLocalStorageItem(SAVED_ITINERARIES_STORAGE_KEY);
    emitPersonalHubStorageChanged(SAVED_ITINERARIES_STORAGE_KEY);
    return normalized;
  }
  writeLocalStorageItem(SAVED_ITINERARIES_STORAGE_KEY, JSON.stringify(normalized));
  emitPersonalHubStorageChanged(SAVED_ITINERARIES_STORAGE_KEY);
  return normalized;
}

export function saveRecentItinerary(entry, maxItems = 5) {
  const normalized = normalizeSavedItineraryEntry(entry);
  if (!normalized) return readSavedItineraries();
  const hasLimit = Number.isFinite(Number(maxItems)) && Number(maxItems) > 0;
  const safeMax = hasLimit ? Math.round(Number(maxItems)) : null;
  const previous = readSavedItineraries();
  const deduped = previous.filter((item) => item.key !== normalized.key);
  const next = [normalized, ...deduped];
  return writeSavedItineraries(safeMax === null ? next : next.slice(0, safeMax));
}

export function removeSavedItinerary(key) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return readSavedItineraries();
  const next = readSavedItineraries().filter((item) => item.key !== normalizedKey);
  return writeSavedItineraries(next);
}

export function createSavedItineraryFromOpportunity(item, label = 'Recently viewed') {
  const itineraryId = String(item?.id || '').trim();
  const origin = String(item?.origin_city || item?.origin_airport || item?.origin || '').trim();
  const destination = String(item?.destination_city || item?.destination_airport || item?.destination || '').trim();
  const routeLabel = [origin, destination].filter(Boolean).join(' -> ').trim() || itineraryId || 'Itinerary';
  const dateFrom = String(item?.depart_date || item?.dateFrom || '').trim();
  const dateTo = String(item?.return_date || item?.dateTo || '').trim();
  const fallbackKey = [routeLabel, dateFrom, dateTo, String(item?.price || '')].join('|');
  return {
    key: itineraryId || fallbackKey,
    itineraryId: itineraryId || null,
    routeLabel,
    price: Number(item?.price),
    currency: String(item?.currency || 'EUR').trim().toUpperCase() || 'EUR',
    label,
    savedAt: new Date().toISOString()
  };
}

export function subscribeToPersonalHubStorage(listener) {
  if (typeof window === 'undefined') return () => {};
  if (typeof listener !== 'function') return () => {};

  const onCustomEvent = () => listener();
  const onConsentEvent = () => listener();
  const onStorageEvent = (event) => {
    const storageKey = String(event?.key || '');
    if (
      storageKey === TRACKED_ROUTES_STORAGE_KEY ||
      storageKey === SAVED_ITINERARIES_STORAGE_KEY ||
      storageKey === RADAR_SESSION_ACTIVE_STORAGE_KEY ||
      !storageKey
    ) {
      listener();
    }
  };

  window.addEventListener(PERSONAL_HUB_STORAGE_EVENT, onCustomEvent);
  window.addEventListener('flight_consent_changed', onConsentEvent);
  window.addEventListener('storage', onStorageEvent);

  return () => {
    window.removeEventListener(PERSONAL_HUB_STORAGE_EVENT, onCustomEvent);
    window.removeEventListener('flight_consent_changed', onConsentEvent);
    window.removeEventListener('storage', onStorageEvent);
  };
}

export function clearLocalTravelData(options = {}) {
  if (typeof window === 'undefined') return { clearedKeys: [], failedKeys: [] };
  const includeAccountHints = Boolean(options.includeAccountHints);
  const keys = includeAccountHints
    ? [...BASE_TRAVEL_STORAGE_KEYS, ...ACCOUNT_HINT_STORAGE_KEYS]
    : [...BASE_TRAVEL_STORAGE_KEYS];
  const clearedKeys = [];
  const failedKeys = [];
  for (const key of keys) {
    if (removeLocalStorageItem(key)) {
      clearedKeys.push(key);
    } else {
      failedKeys.push(key);
    }
  }
  emitPersonalHubStorageChanged('');
  return { clearedKeys, failedKeys };
}

export function exportLocalTravelData(options = {}) {
  if (typeof window === 'undefined') {
    return {
      exportedAt: new Date().toISOString(),
      data: {}
    };
  }
  const includeAccountHints = Boolean(options.includeAccountHints);
  const planRaw = readLocalStorageItem(USER_PLAN_STORAGE_KEY);
  const data = {
    trackedRoutes: readTrackedRouteSlugs(),
    savedItineraries: readSavedItineraries(),
    radarSessionActive: readLocalStorageItem(RADAR_SESSION_ACTIVE_STORAGE_KEY) === '1',
    userPlan: normalizePlanType(planRaw),
    upgradeInterests: readUpgradeInterestRecords()
  };
  if (includeAccountHints) {
    data.accountHints = {
      rememberedEmail: readRememberedEmail(),
      postAuthAction: readTrimmedStorageValue(POST_AUTH_ACTION_STORAGE_KEY, 64),
      postAuthMode: readTrimmedStorageValue(POST_AUTH_MODE_STORAGE_KEY, 32),
      postAuthView: readTrimmedStorageValue(POST_AUTH_VIEW_STORAGE_KEY, 32),
      postAuthSection: readTrimmedStorageValue(POST_AUTH_SECTION_STORAGE_KEY, 32)
    };
  }
  return {
    exportedAt: new Date().toISOString(),
    data
  };
}
