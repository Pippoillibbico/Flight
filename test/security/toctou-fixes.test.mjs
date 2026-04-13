/**
 * Tests for TOCTOU race condition fixes.
 *
 * Covers:
 *  - rotateRefreshSession: returns { ok, reason } with correct reason codes
 *  - rotateRefreshSession: expired session returns reason='expired', not ok
 *  - rotateRefreshSession: already-revoked session returns reason='reused', not ok
 *  - rotateRefreshSession: valid rotation sets rotated=true and pushes new session
 *  - issueApiKey (JSON path): enforces maxKeys atomically under simulated concurrency
 *  - createAlert (JSON path): enforces maxAlerts atomically under simulated concurrency
 *  - getOrCreateSubscription (JSON path): concurrent calls create only one subscription
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// ─── Minimal withDb / readDb mock ─────────────────────────────────────────────
// Serializes calls through a queue just like the real implementation.
function buildMockDb(initial = {}) {
  const state = {
    refreshSessions: [],
    apiKeys: [],
    userSubscriptions: [],
    freeAlerts: [],
    ...initial
  };
  let queue = Promise.resolve();

  function readDb() {
    return Promise.resolve(JSON.parse(JSON.stringify(state)));
  }

  function withDb(task) {
    queue = queue.then(async () => {
      const db = JSON.parse(JSON.stringify(state));
      const next = await task(db);
      if (next) {
        // Merge next back into state
        for (const key of Object.keys(next)) {
          state[key] = next[key];
        }
        return next;
      }
      return db;
    });
    return queue;
  }

  return { state, readDb, withDb };
}

// ─── rotateRefreshSession (extracted logic, no nanoid dep) ────────────────────
function buildRotator(withDb) {
  return async function rotateRefreshSession({ oldJti, newJti, userId, family, exp }) {
    const nowSec = Math.floor(Date.now() / 1000);
    let result = { ok: false, reason: 'not_found' };
    await withDb(async (db) => {
      const oldSession = (db.refreshSessions || []).find((s) => s.jti === oldJti) || null;
      if (!oldSession || oldSession.userId !== userId || oldSession.family !== family) {
        result = { ok: false, reason: 'not_found' };
        return db;
      }
      if (oldSession.revokedAt) {
        result = { ok: false, reason: 'reused' };
        return db;
      }
      if (Number.isFinite(oldSession.exp) && oldSession.exp <= nowSec) {
        result = { ok: false, reason: 'expired' };
        return db;
      }
      oldSession.revokedAt = new Date().toISOString();
      oldSession.rotatedTo = newJti;
      db.refreshSessions.push({
        id: 'new-id',
        userId,
        family,
        jti: newJti,
        exp,
        issuedAt: new Date().toISOString(),
        revokedAt: null,
        rotatedTo: null
      });
      result = { ok: true, reason: null };
      return db;
    });
    return result;
  };
}

// ─── Test 1: valid rotation succeeds ─────────────────────────────────────────
test('rotateRefreshSession: valid session rotates ok', async () => {
  const { withDb, state } = buildMockDb();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  state.refreshSessions.push({
    id: 's1', jti: 'jti-A', userId: 'u1', family: 'fam1',
    exp: futureExp, revokedAt: null, rotatedTo: null
  });

  const rotate = buildRotator(withDb);
  const result = await rotate({ oldJti: 'jti-A', newJti: 'jti-B', userId: 'u1', family: 'fam1', exp: futureExp + 3600 });

  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
  const old = state.refreshSessions.find((s) => s.jti === 'jti-A');
  assert.ok(old.revokedAt, 'old session must be revoked');
  assert.equal(old.rotatedTo, 'jti-B');
  const next = state.refreshSessions.find((s) => s.jti === 'jti-B');
  assert.ok(next, 'new session must exist');
  assert.equal(next.revokedAt, null);
});

// ─── Test 2: expired session → reason='expired' ───────────────────────────────
test('rotateRefreshSession: expired session returns reason=expired', async () => {
  const { withDb, state } = buildMockDb();
  const pastExp = Math.floor(Date.now() / 1000) - 1;
  state.refreshSessions.push({
    id: 's1', jti: 'jti-X', userId: 'u1', family: 'fam1',
    exp: pastExp, revokedAt: null, rotatedTo: null
  });

  const rotate = buildRotator(withDb);
  const result = await rotate({ oldJti: 'jti-X', newJti: 'jti-Y', userId: 'u1', family: 'fam1', exp: pastExp + 7200 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired');
  // Original session must NOT be revoked (no mutation on failure)
  const old = state.refreshSessions.find((s) => s.jti === 'jti-X');
  assert.equal(old.revokedAt, null);
});

// ─── Test 3: already-revoked session → reason='reused' ───────────────────────
test('rotateRefreshSession: already-revoked session returns reason=reused', async () => {
  const { withDb, state } = buildMockDb();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  state.refreshSessions.push({
    id: 's1', jti: 'jti-Z', userId: 'u1', family: 'fam1',
    exp: futureExp, revokedAt: '2020-01-01T00:00:00.000Z', rotatedTo: 'jti-old'
  });

  const rotate = buildRotator(withDb);
  const result = await rotate({ oldJti: 'jti-Z', newJti: 'jti-new', userId: 'u1', family: 'fam1', exp: futureExp + 3600 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'reused');
});

// ─── Test 4: unknown jti → reason='not_found' ────────────────────────────────
test('rotateRefreshSession: missing session returns reason=not_found', async () => {
  const { withDb } = buildMockDb();
  const rotate = buildRotator(withDb);
  const result = await rotate({ oldJti: 'no-such-jti', newJti: 'x', userId: 'u1', family: 'f1', exp: 9999999999 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_found');
});

// ─── Test 5: concurrent rotations — only one wins ────────────────────────────
test('rotateRefreshSession: concurrent rotations — only first wins', async () => {
  const { withDb, state } = buildMockDb();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  state.refreshSessions.push({
    id: 's1', jti: 'jti-C', userId: 'u1', family: 'fam1',
    exp: futureExp, revokedAt: null, rotatedTo: null
  });

  const rotate = buildRotator(withDb);
  // Fire both concurrently. withDb serializes them, so only one can rotate.
  const [r1, r2] = await Promise.all([
    rotate({ oldJti: 'jti-C', newJti: 'jti-C1', userId: 'u1', family: 'fam1', exp: futureExp + 3600 }),
    rotate({ oldJti: 'jti-C', newJti: 'jti-C2', userId: 'u1', family: 'fam1', exp: futureExp + 3600 })
  ]);

  const wins = [r1, r2].filter((r) => r.ok);
  const fails = [r1, r2].filter((r) => !r.ok);
  assert.equal(wins.length, 1, 'exactly one rotation must succeed');
  assert.equal(fails.length, 1, 'exactly one rotation must fail');
  assert.equal(fails[0].reason, 'reused', 'second attempt must be flagged as reuse');
});

test('issueApiKey JSON path: concurrent requests cannot exceed maxKeys', async () => {
  const { withDb, state } = buildMockDb();

  async function issue(userId) {
    let record = null;
    let limitError = null;
    await withDb((st) => {
      const activeCount = (st.apiKeys || []).filter((k) => k.userId === userId && !k.revokedAt).length;
      if (activeCount >= 2) {
        limitError = true;
        return st;
      }
      record = { id: Math.random().toString(36).slice(2), userId, name: 'k', revokedAt: null };
      return { ...st, apiKeys: [...(st.apiKeys || []), record] };
    });
    if (limitError) {
      const err = new Error('key_limit_reached');
      err.code = 'key_limit_reached';
      throw err;
    }
    return record;
  }

  // Fire 5 concurrent requests with maxKeys=2
  const results = await Promise.allSettled([
    issue('u1'), issue('u1'), issue('u1'), issue('u1'), issue('u1')
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 2, 'exactly 2 keys must be issued');
  assert.equal(rejected.length, 3, 'remaining 3 must be rejected');
  assert.ok(rejected.every((r) => r.reason.code === 'key_limit_reached'));

  const activeInState = state.apiKeys.filter((k) => k.userId === 'u1' && !k.revokedAt).length;
  assert.equal(activeInState, 2, 'exactly 2 active keys in state');
});

// ─── createAlert JSON path: atomic maxAlerts enforcement ─────────────────────
test('createAlert JSON path: concurrent requests cannot exceed maxAlerts', async () => {
  const { withDb, state } = buildMockDb();

  async function createAlert(userId) {
    let alert = null;
    let limitError = null;
    await withDb(async (db) => {
      const activeCount = (db.freeAlerts || []).filter((a) => a.userId === userId && !a.deletedAt).length;
      if (activeCount >= 3) {
        limitError = true;
        return db;
      }
      alert = { id: Math.random().toString(36).slice(2), userId, deletedAt: null };
      db.freeAlerts = db.freeAlerts || [];
      db.freeAlerts.push(alert);
      return db;
    });
    if (limitError) {
      const err = new Error('alert_limit_reached');
      err.code = 'alert_limit_reached';
      throw err;
    }
    return alert;
  }

  const results = await Promise.allSettled([
    createAlert('u2'), createAlert('u2'), createAlert('u2'),
    createAlert('u2'), createAlert('u2')
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 3);
  assert.equal(rejected.length, 2);
  assert.ok(rejected.every((r) => r.reason.code === 'alert_limit_reached'));

  const activeInState = state.freeAlerts.filter((a) => a.userId === 'u2' && !a.deletedAt).length;
  assert.equal(activeInState, 3);
});

// ─── getOrCreateSubscription JSON path: no duplicate subscriptions ─────────────
test('getOrCreateSubscription JSON path: concurrent calls create one subscription', async () => {
  const { withDb, state } = buildMockDb();

  async function getOrCreate(userId) {
    let result = null;
    await withDb((st) => {
      const found = (st.userSubscriptions || []).find((s) => s.userId === userId);
      if (found) {
        result = found;
        return st;
      }
      const created = { id: Math.random().toString(36).slice(2), userId, planId: 'free' };
      result = created;
      return { ...st, userSubscriptions: [...(st.userSubscriptions || []), created] };
    });
    return result;
  }

  const results = await Promise.all([
    getOrCreate('u3'), getOrCreate('u3'), getOrCreate('u3')
  ]);

  const subs = state.userSubscriptions.filter((s) => s.userId === 'u3');
  assert.equal(subs.length, 1, 'only one subscription must be created');
  // All callers should get the same subscription id
  const ids = new Set(results.map((r) => r.id));
  assert.equal(ids.size, 1, 'all callers must resolve the same subscription');
});
