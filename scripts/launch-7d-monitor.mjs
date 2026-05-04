import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 7;

function parseArg(name, fallback = null) {
  const prefix = `${name}=`;
  for (const rawArg of process.argv.slice(2)) {
    if (rawArg.startsWith(prefix)) return rawArg.slice(prefix.length);
  }
  return fallback;
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoDay(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function toDayRange(days, endAt = Date.now()) {
  const endDate = new Date(endAt);
  const endUtc = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  const output = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    output.push(toIsoDay(endUtc - offset * DAY_MS));
  }
  return output;
}

function getEventDay(record) {
  return toIsoDay(record?.at || record?.createdAt || record?.issuedAt || record?.updatedAt);
}

function incCount(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function getActorKey(record) {
  const userId = String(record?.userId || '').trim();
  if (userId) return `user:${userId}`;
  const sessionId = String(record?.sessionId || '').trim();
  if (sessionId) return `session:${sessionId}`;
  const correlationId = String(record?.correlationId || '').trim();
  if (correlationId) return `correlation:${correlationId}`;
  const clickId = String(record?.clickId || '').trim();
  if (clickId) return `click:${clickId}`;
  return null;
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function pct(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function int(value) {
  return Number(value || 0).toLocaleString('it-IT');
}

function markdownTable(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

function evaluateAlerts({
  today,
  rolling,
  redirectFailureRate,
  stripeFailures24h,
  aiCostToday,
  aiCostBaseline
}) {
  const alerts = [];
  if (today.outboundClicked === 0 && today.dealOpened >= 20) {
    alerts.push('CRITICO: outbound_clicked=0 oggi con deal_opened>=20.');
  }
  if (rolling.upgradeCompleted === 0 && rolling.paywallViewed >= 30) {
    alerts.push('CRITICO: upgrade_completed=0 negli ultimi 7 giorni con paywall_viewed>=30.');
  }
  if (Number.isFinite(redirectFailureRate) && redirectFailureRate >= 0.05) {
    alerts.push(`CRITICO: outbound redirect failure rate alta (${pct(redirectFailureRate)}).`);
  }
  if (stripeFailures24h > 0) {
    alerts.push(`CRITICO: Stripe failures ultime 24h = ${stripeFailures24h}.`);
  }
  if (Number.isFinite(aiCostToday) && Number.isFinite(aiCostBaseline) && aiCostBaseline > 0 && aiCostToday > aiCostBaseline * 1.5) {
    alerts.push(`CRITICO: costo AI/provider anomalo oggi (${aiCostToday.toFixed(2)} EUR vs baseline ${aiCostBaseline.toFixed(2)} EUR).`);
  }
  if (alerts.length === 0) {
    alerts.push('Nessun alert critico attivo con i dati disponibili.');
  }
  return alerts;
}

function findNumericCost(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const candidates = [
    snapshot?.totalCostEur,
    snapshot?.providerCostEur,
    snapshot?.aiCostEur,
    snapshot?.costEur,
    snapshot?.cost?.totalEur,
    snapshot?.cost?.providerEur,
    snapshot?.cost?.aiEur
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

async function run() {
  const dbPathArg = parseArg('--db');
  const daysArg = parseArg('--days');
  const days = Math.max(1, toNumber(daysArg, DEFAULT_WINDOW_DAYS));
  const dbPath = resolve(process.cwd(), dbPathArg || 'data/db.json');
  const db = await readJson(dbPath);

  const telemetry = Array.isArray(db.clientTelemetryEvents) ? db.clientTelemetryEvents : [];
  const outboundClicks = Array.isArray(db.outboundClicks) ? db.outboundClicks : [];
  const stripeWebhookEvents = Array.isArray(db.stripeWebhookEvents) ? db.stripeWebhookEvents : [];
  const aiCostSnapshots = Array.isArray(db.aiCostSnapshots) ? db.aiCostSnapshots : [];

  const dayKeys = toDayRange(days);
  const daySet = new Set(dayKeys);
  const byDay = new Map(
    dayKeys.map((day) => [
      day,
      {
        homepageViewed: 0,
        teaserDealViewed: 0,
        dealOpened: 0,
        outboundClicked: 0,
        signupCompleted: 0,
        paywallViewed: 0,
        upgradeStarted: 0,
        upgradeCompleted: 0,
        alternativeDepartureViewed: 0,
        alternativeDepartureClicked: 0
      }
    ])
  );

  const actorsByDay = new Map(dayKeys.map((day) => [day, new Set()]));
  const outboundEventsByDay = new Map(dayKeys.map((day) => [day, { success: 0, failed: 0 }]));

  for (const event of telemetry) {
    const day = getEventDay(event);
    if (!daySet.has(day)) continue;
    const stats = byDay.get(day);
    const eventType = String(event?.eventType || '').trim().toLowerCase();
    if (eventType === 'homepage_viewed') stats.homepageViewed += 1;
    if (eventType === 'teaser_deal_viewed') stats.teaserDealViewed += 1;
    if (eventType === 'deal_opened') stats.dealOpened += 1;
    if (eventType === 'outbound_clicked') stats.outboundClicked += 1;
    if (eventType === 'signup_completed') stats.signupCompleted += 1;
    if (eventType === 'paywall_viewed') stats.paywallViewed += 1;
    if (eventType === 'upgrade_started') stats.upgradeStarted += 1;
    if (eventType === 'upgrade_completed') stats.upgradeCompleted += 1;
    if (eventType === 'alternative_departure_viewed') stats.alternativeDepartureViewed += 1;
    if (eventType === 'alternative_departure_clicked') stats.alternativeDepartureClicked += 1;

    const actorKey = getActorKey(event);
    if (actorKey) actorsByDay.get(day).add(actorKey);
  }

  for (const event of outboundClicks) {
    const day = getEventDay(event);
    if (!daySet.has(day)) continue;
    const name = String(event?.eventName || '').trim().toLowerCase();
    const outboundDay = outboundEventsByDay.get(day);
    if (name === 'booking_clicked' || name === 'outbound_redirect_succeeded') {
      outboundDay.success += 1;
    }
    if (name === 'outbound_redirect_failed') {
      outboundDay.failed += 1;
    }
    const actorKey = getActorKey(event);
    if (actorKey) actorsByDay.get(day).add(actorKey);
  }

  // If telemetry outbound_clicked is missing, fallback to outbound success events for that day.
  for (const day of dayKeys) {
    const stats = byDay.get(day);
    const outboundDay = outboundEventsByDay.get(day);
    if (stats.outboundClicked === 0 && outboundDay.success > 0) {
      stats.outboundClicked = outboundDay.success;
    }
  }

  const rows = [];
  const rolling = {
    homepageViewed: 0,
    dealOpened: 0,
    outboundClicked: 0,
    signupCompleted: 0,
    paywallViewed: 0,
    upgradeCompleted: 0
  };

  let previousDayActors = new Set();
  let cumulativeActors = new Set();

  for (let index = 0; index < dayKeys.length; index += 1) {
    const day = dayKeys[index];
    const stats = byDay.get(day);
    const actors = actorsByDay.get(day) || new Set();
    const returning = new Set([...actors].filter((actor) => cumulativeActors.has(actor)));
    const retentionRate = ratio(returning.size, previousDayActors.size);

    const dealCtr = ratio(stats.dealOpened, stats.homepageViewed);
    const outboundCtr = ratio(stats.outboundClicked, stats.dealOpened);
    const signupConversion = ratio(stats.signupCompleted, stats.outboundClicked);
    const upgradeConversion = ratio(stats.upgradeCompleted, stats.paywallViewed);

    rows.push({
      day,
      dayIndex: index + 1,
      homepageViewed: stats.homepageViewed,
      dealOpened: stats.dealOpened,
      outboundClicked: stats.outboundClicked,
      signupCompleted: stats.signupCompleted,
      paywallViewed: stats.paywallViewed,
      upgradeCompleted: stats.upgradeCompleted,
      dealCtr,
      outboundCtr,
      signupConversion,
      upgradeConversion,
      activeUsers: actors.size,
      returningUsers: returning.size,
      retentionRate
    });

    rolling.homepageViewed += stats.homepageViewed;
    rolling.dealOpened += stats.dealOpened;
    rolling.outboundClicked += stats.outboundClicked;
    rolling.signupCompleted += stats.signupCompleted;
    rolling.paywallViewed += stats.paywallViewed;
    rolling.upgradeCompleted += stats.upgradeCompleted;

    previousDayActors = actors;
    cumulativeActors = new Set([...cumulativeActors, ...actors]);
  }

  const lastDay = rows[rows.length - 1] || {
    dealOpened: 0,
    outboundClicked: 0
  };

  let redirectSuccess = 0;
  let redirectFailed = 0;
  for (const day of dayKeys) {
    const outboundDay = outboundEventsByDay.get(day);
    redirectSuccess += toNumber(outboundDay?.success, 0);
    redirectFailed += toNumber(outboundDay?.failed, 0);
  }
  const redirectFailureRate = ratio(redirectFailed, redirectSuccess + redirectFailed);

  const nowMs = Date.now();
  const stripeFailures24h = stripeWebhookEvents.filter((event) => {
    const atMs = new Date(event?.updatedAt || event?.processedAt || event?.createdAt || '').getTime();
    if (!Number.isFinite(atMs) || atMs < nowMs - DAY_MS) return false;
    const status = String(event?.status || '').toLowerCase();
    const type = String(event?.type || '').toLowerCase();
    return status === 'failed' || type.includes('invoice.payment_failed');
  }).length;

  const aiDailyCosts = new Map();
  for (const snapshot of aiCostSnapshots) {
    const day = getEventDay(snapshot);
    if (!day) continue;
    const cost = findNumericCost(snapshot);
    if (!Number.isFinite(cost)) continue;
    incCount(aiDailyCosts, day, cost);
  }
  const aiCostToday = aiDailyCosts.get(dayKeys[dayKeys.length - 1]);
  const historicalCosts = dayKeys
    .slice(0, -1)
    .map((day) => aiDailyCosts.get(day))
    .filter((value) => Number.isFinite(value));
  const aiCostBaseline =
    historicalCosts.length > 0 ? historicalCosts.reduce((sum, value) => sum + value, 0) / historicalCosts.length : null;

  const alerts = evaluateAlerts({
    today: lastDay,
    rolling,
    redirectFailureRate,
    stripeFailures24h,
    aiCostToday,
    aiCostBaseline
  });

  const dashboardRows = [
    ['Traffico totale', int(rolling.homepageViewed), 'homepage_viewed'],
    ['CTR deal', pct(ratio(rolling.dealOpened, rolling.homepageViewed)), 'deal_opened / homepage_viewed'],
    ['CTR outbound', pct(ratio(rolling.outboundClicked, rolling.dealOpened)), 'outbound_clicked / deal_opened'],
    ['Conversione signup', pct(ratio(rolling.signupCompleted, rolling.outboundClicked)), 'signup_completed / outbound_clicked'],
    ['Conversione upgrade', pct(ratio(rolling.upgradeCompleted, rolling.paywallViewed)), 'upgrade_completed / paywall_viewed'],
    ['Retention utenti tornati', pct(rows[rows.length - 1]?.retentionRate), 'returning_users(today) / active_users(yesterday)']
  ];

  const dailyRows = rows.map((row) => [
    `G${row.dayIndex} (${row.day})`,
    int(row.homepageViewed),
    int(row.dealOpened),
    pct(row.dealCtr),
    pct(row.outboundCtr),
    pct(row.signupConversion),
    pct(row.upgradeConversion),
    int(row.returningUsers)
  ]);

  const reportLines = [];
  reportLines.push(`# Launch 7D Monitoring Report`);
  reportLines.push('');
  reportLines.push(`Source DB: \`${dbPath}\``);
  reportLines.push(`Generated at: ${new Date().toISOString()}`);
  reportLines.push('');
  reportLines.push('## Dashboard minima (rolling finestra)');
  reportLines.push(
    markdownTable(
      ['Metrica', 'Valore', 'Formula'],
      dashboardRows
    )
  );
  reportLines.push('');
  reportLines.push('## Andamento giornaliero');
  reportLines.push(
    markdownTable(
      ['Giorno', 'Traffico', 'Deal opened', 'CTR deal', 'CTR outbound', 'Conv signup', 'Conv upgrade', 'Returning users'],
      dailyRows
    )
  );
  reportLines.push('');
  reportLines.push('## Alert critici');
  for (const line of alerts) {
    reportLines.push(`- ${line}`);
  }

  console.log(reportLines.join('\n'));
}

run().catch((error) => {
  console.error('launch-7d-monitor failed:', error?.message || error);
  process.exit(1);
});
