import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIT_LOG_FILE = new URL('../../data/audit-log.ndjson', import.meta.url);
const AUDIT_LOG_PATH = fileURLToPath(AUDIT_LOG_FILE);
const AUDIT_HMAC_KEY = String(process.env.AUDIT_LOG_HMAC_KEY || '');
let writeQueue = Promise.resolve();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readLastHash() {
  try {
    const raw = await readFile(AUDIT_LOG_FILE, 'utf8');
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
    const previousHash = await readLastHash();
    const entry = {
      at: new Date().toISOString(),
      previousHash,
      event
    };
    const hash = sha256(JSON.stringify(entry));
    const signature = AUDIT_HMAC_KEY ? createHmac('sha256', AUDIT_HMAC_KEY).update(hash).digest('hex') : null;
    const line = JSON.stringify({ ...entry, hash, signature }) + '\n';
    await appendFile(AUDIT_LOG_FILE, line, 'utf8');
  });
  return writeQueue;
}

export async function verifyImmutableAudit() {
  try {
    const raw = await readFile(AUDIT_LOG_FILE, 'utf8');
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
