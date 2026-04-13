import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DB_FILE = fileURLToPath(new URL('../../data/db.json', import.meta.url));
const DB_FILE = resolve(String(process.env.FLIGHT_DB_FILE || DEFAULT_DB_FILE));

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
  stripeWebhookEvents: []
};

let queue = Promise.resolve();

async function ensureDb() {
  if (existsSync(DB_FILE)) return;
  await mkdir(dirname(DB_FILE), { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
}

export async function readDb() {
  await ensureDb();
  const raw = await readFile(DB_FILE, 'utf8');
  const parsed = JSON.parse(raw);
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
    stripeWebhookEvents: parsed.stripeWebhookEvents ?? []
  };
}

export async function writeDb(nextData) {
  await ensureDb();
  await writeFile(DB_FILE, JSON.stringify(nextData, null, 2));
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
