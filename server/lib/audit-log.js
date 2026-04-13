import { appendFile, mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_AUDIT_LOG_PATH = fileURLToPath(new URL('../../data/audit-log.ndjson', import.meta.url));
const AUDIT_LOG_PATH = resolve(String(process.env.AUDIT_LOG_FILE || DEFAULT_AUDIT_LOG_PATH));
const AUDIT_LOG_LOCK_PATH = `${AUDIT_LOG_PATH}.lock`;
const AUDIT_HMAC_KEY = String(process.env.AUDIT_LOG_HMAC_KEY || '');
const AUDIT_LOCK_WAIT_MS = Math.max(250, Number(process.env.AUDIT_LOG_LOCK_WAIT_MS || 2000));
const AUDIT_LOCK_POLL_MS = Math.max(25, Number(process.env.AUDIT_LOG_LOCK_POLL_MS || 75));
const AUDIT_LOCK_STALE_MS = Math.max(1000, Number(process.env.AUDIT_LOG_LOCK_STALE_MS || 30_000));
let writeQueue = Promise.resolve();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function acquireAppendLock() {
  const deadline = Date.now() + AUDIT_LOCK_WAIT_MS;
  while (Date.now() <= deadline) {
    try {
      return await open(AUDIT_LOG_LOCK_PATH, 'wx');
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const lockInfo = await stat(AUDIT_LOG_LOCK_PATH);
        if (Date.now() - Number(lockInfo?.mtimeMs || 0) > AUDIT_LOCK_STALE_MS) {
          await unlink(AUDIT_LOG_LOCK_PATH).catch(() => {});
          continue;
        }
      } catch {}
      await sleep(AUDIT_LOCK_POLL_MS);
    }
  }
  const lockError = new Error('audit_log_lock_timeout');
  lockError.code = 'AUDIT_LOG_LOCK_TIMEOUT';
  throw lockError;
}

async function releaseAppendLock(lockHandle) {
  try {
    await lockHandle?.close?.();
  } finally {
    await unlink(AUDIT_LOG_LOCK_PATH).catch(() => {});
  }
}

async function readLastHash() {
  try {
    const raw = await readFile(AUDIT_LOG_PATH, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    if (!lines.length) return 'GENESIS';
    const last = JSON.parse(lines[lines.length - 1]);
    return String(last.hash || 'GENESIS');
  } catch {
    return 'GENESIS';
  }
}

export function appendImmutableAudit(event) {
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(AUDIT_LOG_PATH), { recursive: true });
    const lockHandle = await acquireAppendLock();
    try {
      const previousHash = await readLastHash();
      const entry = {
        at: new Date().toISOString(),
        previousHash,
        event
      };
      const hash = sha256(JSON.stringify(entry));
      const signature = AUDIT_HMAC_KEY ? createHmac('sha256', AUDIT_HMAC_KEY).update(hash).digest('hex') : null;
      const line = JSON.stringify({ ...entry, hash, signature }) + '\n';
      await appendFile(AUDIT_LOG_PATH, line, 'utf8');
    } finally {
      await releaseAppendLock(lockHandle);
    }
  });
  return writeQueue;
}

export async function verifyImmutableAudit() {
  try {
    const raw = await readFile(AUDIT_LOG_PATH, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    let expectedPrev = 'GENESIS';
    let count = 0;
    for (const line of lines) {
      const parsed = JSON.parse(line);
      const { hash, signature, ...withoutHash } = parsed;
      const recomputed = sha256(JSON.stringify(withoutHash));
      const signatureOk = AUDIT_HMAC_KEY
        ? parsed.signature === createHmac('sha256', AUDIT_HMAC_KEY).update(String(parsed.hash || '')).digest('hex')
        : true;
      if (parsed.previousHash !== expectedPrev || recomputed !== hash || !signatureOk) {
        return { ok: false, count, brokenAt: count + 1 };
      }
      expectedPrev = hash;
      count += 1;
    }
    return { ok: true, count, brokenAt: null };
  } catch {
    return { ok: true, count: 0, brokenAt: null };
  }
}
