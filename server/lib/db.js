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

const initialData = {
  users: [],
  watchlists: [],
  searches: [],
  alertSubscriptions: [],
  notifications: [],
  authEvents: [],
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
  pushDeadLetters: []
};

let queue = Promise.resolve();
let maintenancePromise = null;

function normalizeDb(parsed) {
  return {
    users: parsed.users ?? [],
    watchlists: parsed.watchlists ?? [],
    searches: parsed.searches ?? [],
    alertSubscriptions: parsed.alertSubscriptions ?? [],
    notifications: parsed.notifications ?? [],
    authEvents: parsed.authEvents ?? [],
    outboundClicks: parsed.outboundClicks ?? [],
    outboundRedirects: parsed.outboundRedirects ?? [],
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
    await rename(tmpFile, DB_FILE);
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
