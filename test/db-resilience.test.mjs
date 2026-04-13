import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function loadDbModuleForFile(dbFile, overrides = {}) {
  const trackedKeys = [
    'FLIGHT_DB_FILE',
    'FLIGHT_DB_CORRUPT_KEEP',
    'FLIGHT_DB_TMP_RETENTION_HOURS',
    'DATA_RETENTION_AUTH_EVENTS_DAYS',
    'DATA_RETENTION_CLIENT_TELEMETRY_DAYS',
    'DATA_RETENTION_OUTBOUND_EVENTS_DAYS'
  ];
  const snapshot = snapshotEnv(trackedKeys);
  process.env.FLIGHT_DB_FILE = dbFile;
  process.env.FLIGHT_DB_CORRUPT_KEEP = String(overrides.corruptKeep ?? 5);
  process.env.FLIGHT_DB_TMP_RETENTION_HOURS = String(overrides.tmpRetentionHours ?? 24);
  process.env.DATA_RETENTION_AUTH_EVENTS_DAYS = String(overrides.authRetentionDays ?? 180);
  process.env.DATA_RETENTION_CLIENT_TELEMETRY_DAYS = String(overrides.telemetryRetentionDays ?? 120);
  process.env.DATA_RETENTION_OUTBOUND_EVENTS_DAYS = String(overrides.outboundRetentionDays ?? 180);
  const cacheBust = `${Date.now()}_${Math.random()}`;
  const mod = await import(`../server/lib/db.js?db_test=${cacheBust}`);
  return {
    mod,
    restore() {
      restoreEnv(snapshot);
    }
  };
}

test('readDb recovers from corrupted primary file using backup snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flight-db-recover-'));
  const dbFile = join(dir, 'db.json');
  const backupPayload = {
    users: [{ id: 'u1', email: 'u1@example.com' }],
    watchlists: []
  };

  await writeFile(dbFile, '{"users":[', 'utf8');
  await writeFile(`${dbFile}.bak`, JSON.stringify(backupPayload, null, 2), 'utf8');

  const { mod, restore } = await loadDbModuleForFile(dbFile);
  try {
    const db = await mod.readDb();
    assert.equal(Array.isArray(db.users), true);
    assert.equal(db.users.length, 1);
    assert.equal(db.users[0].id, 'u1');

    const repairedRaw = await readFile(dbFile, 'utf8');
    const repaired = JSON.parse(repairedRaw);
    assert.equal(Array.isArray(repaired.users), true);
    assert.equal(repaired.users.length, 1);
    assert.equal(repaired.users[0].id, 'u1');
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('readDb applies retention policy for tmp and corrupt artifacts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flight-db-retention-'));
  const dbFile = join(dir, 'db.json');
  await writeFile(dbFile, '{}', 'utf8');

  const corruptNames = [
    `${dbFile}.corrupt-1000`,
    `${dbFile}.corrupt-1001`,
    `${dbFile}.corrupt-1002`,
    `${dbFile}.corrupt-1003`
  ];
  for (const name of corruptNames) await writeFile(name, '{"broken":true}', 'utf8');

  const tmpNames = [`${dbFile}.tmp-a`, `${dbFile}.tmp-b`];
  for (const name of tmpNames) {
    await writeFile(name, '{"tmp":true}', 'utf8');
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(name, past, past);
  }

  const { mod, restore } = await loadDbModuleForFile(dbFile, {
    corruptKeep: 2,
    tmpRetentionHours: 0
  });

  try {
    const db = await mod.readDb();
    assert.equal(Array.isArray(db.users), true);

    const names = await readdir(dir);
    const remainingCorrupt = names.filter((name) => name.startsWith('db.json.corrupt-')).sort();
    const remainingTmp = names.filter((name) => name.startsWith('db.json.tmp-')).sort();

    assert.deepEqual(remainingCorrupt, ['db.json.corrupt-1002', 'db.json.corrupt-1003']);
    assert.equal(remainingTmp.length, 0);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('readDb prunes aged auth/telemetry/outbound events by retention policy', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flight-db-data-retention-'));
  const dbFile = join(dir, 'db.json');
  const oldIso = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const freshIso = new Date().toISOString();
  await writeFile(
    dbFile,
    JSON.stringify(
      {
        authEvents: [
          { id: 'auth_old', at: oldIso, type: 'login_success', success: true },
          { id: 'auth_new', at: freshIso, type: 'login_success', success: true }
        ],
        clientTelemetryEvents: [
          { id: 'tel_old', at: oldIso, eventType: 'itinerary_opened' },
          { id: 'tel_new', at: freshIso, eventType: 'itinerary_opened' }
        ],
        outboundClicks: [
          { id: 'out_old', at: oldIso, eventName: 'booking_clicked' },
          { id: 'out_new', at: freshIso, eventName: 'booking_clicked' }
        ],
        outboundRedirects: [
          { id: 'redir_old', at: oldIso, eventName: 'outbound_redirect_succeeded' },
          { id: 'redir_new', at: freshIso, eventName: 'outbound_redirect_succeeded' }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const { mod, restore } = await loadDbModuleForFile(dbFile, {
    authRetentionDays: 30,
    telemetryRetentionDays: 30,
    outboundRetentionDays: 30
  });

  try {
    const db = await mod.readDb();
    assert.equal(db.authEvents.length, 1);
    assert.equal(db.authEvents[0]?.id, 'auth_new');
    assert.equal(db.clientTelemetryEvents.length, 1);
    assert.equal(db.clientTelemetryEvents[0]?.id, 'tel_new');
    assert.equal(db.outboundClicks.length, 1);
    assert.equal(db.outboundClicks[0]?.id, 'out_new');
    assert.equal(db.outboundRedirects.length, 1);
    assert.equal(db.outboundRedirects[0]?.id, 'redir_new');
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});
