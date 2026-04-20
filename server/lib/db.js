import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DB_FILE = fileURLToPath(new URL('../../data/db.json', import.meta.url));
const DB_FILE = resolve(String(process.env.FLIGHT_DB_FILE || DEFAULT_DB_FILE));
const DB_BAK_FILE = `${DB_FILE}.bak`;
const DB_BASENAME = basename(DB_FILE);
const DB_DIRNAME = dirname(DB_FILE);
const DB_CORRUPT_KEEP_MAX = Math.max(1, Number(process.env.FLIGHT_DB_CORRUPT_KEEP || 5));
const DB_TMP_RETENTION_HOURS = Math.max(0, Number(process.env.FLIGHT_DB_TMP_RETENTION_HOURS || 24));
const DB_TMP_RETENTION_MS = DB_TMP_RETENTION_HOURS * 60 * 60 * 1000;
const DB_ATOMIC_RENAME_RETRIES = Math.max(0, Number(process.env.FLIGHT_DB_RENAME_RETRIES || 4));
const DB_ATOMIC_RENAME_RETRY_DELAY_MS = Math.max(5, Number(process.env.FLIGHT_DB_RENAME_RETRY_DELAY_MS || 35));
const DAY_MS = 24 * 60 * 60 * 1000;

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRenameError(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'EMFILE' || code === 'ENFILE';
}

function safePositiveInt(rawValue, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

const AUTH_EVENTS_RETENTION_DAYS = safePositiveInt(process.env.DATA_RETENTION_AUTH_EVENTS_DAYS, 180, { min: 7, max: 3650 });
const CLIENT_TELEMETRY_RETENTION_DAYS = safePositiveInt(process.env.DATA_RETENTION_CLIENT_TELEMETRY_DAYS, 120, { min: 7, max: 3650 });
const OUTBOUND_EVENTS_RETENTION_DAYS = safePositiveInt(process.env.DATA_RETENTION_OUTBOUND_EVENTS_DAYS, 180, { min: 7, max: 3650 });
const AUTH_EVENTS_MAX_ITEMS = safePositiveInt(process.env.DATA_RETENTION_AUTH_EVENTS_MAX, 3000, { min: 100, max: 50000 });
const CLIENT_TELEMETRY_MAX_ITEMS = safePositiveInt(process.env.DATA_RETENTION_CLIENT_TELEMETRY_MAX, 12000, { min: 100, max: 100000 });
const OUTBOUND_EVENTS_MAX_ITEMS = safePositiveInt(process.env.DATA_RETENTION_OUTBOUND_EVENTS_MAX, 5000, { min: 100, max: 50000 });

const initialData = {
  users: [],
  watchlists: [],
  searches: [],
  alertSubscriptions: [],
  notifications: [],
  authEvents: [],
  clientTelemetryEvents: [],
  outboundClicks: [],
  outboundRedirects: [],
  revokedTokens: [],
  refreshSessions: [],
  mfaChallenges: [],
  oauthSessions: [],
  subscriptionPricing: {
    free: { monthlyEur: 0 },
    pro: { monthlyEur: 12.99 },
    creator: { monthlyEur: 29.99 },
    updatedAt: null,
    lastCostCheckAt: null
  },
  aiCostSnapshots: [],
  // SaaS monetization (used when DATABASE_URL is not set)
  apiKeys: [],
  userSubscriptions: [],
  monthlyQuotas: [],
  usageEvents: [],
  usageCounters: [],
  alertIntelligenceDedupe: [],
  passwordResetTokens: [],
  freeAlerts: [],
  freePrecomputedRankings: [],
  freeTravelScores: [],
  freeAlertSignals: [],
  stripeWebhookEvents: [],
  radarPreferences: [],
  radarMatchSnapshots: [],
  pushDeadLetters: [],
  pushSubscriptions: []
};

let queue = Promise.resolve();
let maintenancePromise = null;

function eventTimestampMs(record, dateKeys = ['at']) {
  if (!record || typeof record !== 'object') return Number.NaN;
  for (const key of dateKeys) {
    const value = record?.[key];
    if (!value) continue;
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

function pruneTimedCollection(collection, { retentionDays, maxItems, dateKeys }) {
  const source = Array.isArray(collection) ? collection : [];
  const cutoffMs = Date.now() - retentionDays * DAY_MS;
  const normalized = source.filter((item) => {
    const atMs = eventTimestampMs(item, dateKeys);
    if (!Number.isFinite(atMs)) return false;
    return atMs >= cutoffMs;
  });
  if (normalized.length <= maxItems) return normalized;
  return normalized.slice(-maxItems);
}

function normalizeDb(parsed) {
  return {
    users: parsed.users ?? [],
    watchlists: parsed.watchlists ?? [],
    searches: parsed.searches ?? [],
    alertSubscriptions: parsed.alertSubscriptions ?? [],
    notifications: parsed.notifications ?? [],
    authEvents: pruneTimedCollection(parsed.authEvents, {
      retentionDays: AUTH_EVENTS_RETENTION_DAYS,
      maxItems: AUTH_EVENTS_MAX_ITEMS,
      dateKeys: ['at']
    }),
    clientTelemetryEvents: pruneTimedCollection(parsed.clientTelemetryEvents, {
      retentionDays: CLIENT_TELEMETRY_RETENTION_DAYS,
      maxItems: CLIENT_TELEMETRY_MAX_ITEMS,
      dateKeys: ['at']
    }),
    outboundClicks: pruneTimedCollection(parsed.outboundClicks, {
      retentionDays: OUTBOUND_EVENTS_RETENTION_DAYS,
      maxItems: OUTBOUND_EVENTS_MAX_ITEMS,
      dateKeys: ['at', 'clickedAt', 'createdAt']
    }),
    outboundRedirects: pruneTimedCollection(parsed.outboundRedirects, {
      retentionDays: OUTBOUND_EVENTS_RETENTION_DAYS,
      maxItems: OUTBOUND_EVENTS_MAX_ITEMS,
      dateKeys: ['issuedAt', 'expiresAt', 'at', 'createdAt']
    }),
    revokedTokens: parsed.revokedTokens ?? [],
    refreshSessions: parsed.refreshSessions ?? [],
    mfaChallenges: parsed.mfaChallenges ?? [],
    oauthSessions: parsed.oauthSessions ?? [],
    subscriptionPricing: parsed.subscriptionPricing ?? initialData.subscriptionPricing,
    aiCostSnapshots: parsed.aiCostSnapshots ?? [],
    apiKeys: parsed.apiKeys ?? [],
    userSubscriptions: parsed.userSubscriptions ?? [],
    monthlyQuotas: parsed.monthlyQuotas ?? [],
    usageEvents: parsed.usageEvents ?? [],
    usageCounters: parsed.usageCounters ?? [],
    alertIntelligenceDedupe: parsed.alertIntelligenceDedupe ?? [],
    passwordResetTokens: parsed.passwordResetTokens ?? [],
    freeAlerts: parsed.freeAlerts ?? [],
    freePrecomputedRankings: parsed.freePrecomputedRankings ?? [],
    freeTravelScores: parsed.freeTravelScores ?? [],
    freeAlertSignals: parsed.freeAlertSignals ?? [],
    stripeWebhookEvents: parsed.stripeWebhookEvents ?? [],
    radarPreferences: parsed.radarPreferences ?? [],
    radarMatchSnapshots: parsed.radarMatchSnapshots ?? [],
    pushDeadLetters: parsed.pushDeadLetters ?? []
  };
}

async function readJsonSafe(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error };
  }
}

function parseCorruptTimestamp(fileName) {
  const match = String(fileName || '').match(/\.corrupt-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function cleanupDbArtifacts() {
  let entries = [];
  try {
    entries = await readdir(DB_DIRNAME);
  } catch {
    return;
  }

  const now = Date.now();
  const tmpPrefix = `${DB_BASENAME}.tmp-`;
  const corruptPrefix = `${DB_BASENAME}.corrupt-`;

  const tmpFiles = entries.filter((name) => name.startsWith(tmpPrefix));
  await Promise.all(
    tmpFiles.map(async (name) => {
      const fullPath = resolve(DB_DIRNAME, name);
      try {
        const fileStat = await stat(fullPath);
        const fileAgeMs = Math.max(0, now - Number(fileStat.mtimeMs || 0));
        if (fileAgeMs >= DB_TMP_RETENTION_MS) await unlink(fullPath);
      } catch {}
    })
  );

  const corruptFiles = entries
    .filter((name) => name.startsWith(corruptPrefix))
    .sort((a, b) => parseCorruptTimestamp(b) - parseCorruptTimestamp(a));

  const toDelete = corruptFiles.slice(DB_CORRUPT_KEEP_MAX);
  await Promise.all(
    toDelete.map(async (name) => {
      try {
        await unlink(resolve(DB_DIRNAME, name));
      } catch {}
    })
  );
}

function runMaintenanceOnce() {
  if (maintenancePromise) return maintenancePromise;
  maintenancePromise = cleanupDbArtifacts();
  return maintenancePromise;
}

async function ensureDb() {
  await mkdir(DB_DIRNAME, { recursive: true });
  await runMaintenanceOnce();
  if (existsSync(DB_FILE)) return;
  await writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
}

export async function readDb() {
  await ensureDb();
  const primary = await readJsonSafe(DB_FILE);
  if (primary.ok) return normalizeDb(primary.value || {});

  const backup = await readJsonSafe(DB_BAK_FILE);
  if (backup.ok) {
    await writeFile(DB_FILE, JSON.stringify(backup.value, null, 2));
    return normalizeDb(backup.value || {});
  }

  // Last-resort recovery: preserve unreadable payload and continue with clean structure.
  try {
    await rename(DB_FILE, `${DB_FILE}.corrupt-${Date.now()}`);
  } catch {}
  await writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
  return normalizeDb(initialData);
}

export async function writeDb(nextData) {
  await ensureDb();
  const payload = JSON.stringify(nextData, null, 2);
  const tmpFile = `${DB_FILE}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpFile, payload);
  try {
    if (existsSync(DB_FILE)) await copyFile(DB_FILE, DB_BAK_FILE);
    for (let attempt = 0; attempt <= DB_ATOMIC_RENAME_RETRIES; attempt += 1) {
      try {
        await rename(tmpFile, DB_FILE);
        break;
      } catch (error) {
        const shouldRetry = isTransientRenameError(error) && attempt < DB_ATOMIC_RENAME_RETRIES;
        if (!shouldRetry) throw error;
        await waitMs(DB_ATOMIC_RENAME_RETRY_DELAY_MS * (attempt + 1));
      }
    }
  } finally {
    try {
      if (existsSync(tmpFile)) await unlink(tmpFile);
    } catch {}
  }
}

export function withDb(task) {
  queue = queue.then(async () => {
    const db = await readDb();
    const next = await task(db);
    if (next) {
      await writeDb(next);
      return next;
    }
    return db;
  });

  return queue;
}
