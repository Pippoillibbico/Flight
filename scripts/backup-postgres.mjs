import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AUDIT_LOG_PATH = fileURLToPath(new URL('../data/audit-log.ndjson', import.meta.url));
const BACKUP_DIR = resolve(process.cwd(), process.env.BACKUP_DIR || 'backups');
const BACKUP_ENCRYPTION_KEY = String(process.env.BACKUP_ENCRYPTION_KEY || '').trim();
const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const KEEP_PLAINTEXT_BACKUPS = String(process.env.BACKUP_KEEP_PLAINTEXT || 'false').trim().toLowerCase() === 'true';

function stamp() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}

function runPgDump(targetPath) {
  return new Promise((resolveOk, reject) => {
    const url = String(process.env.DATABASE_URL || '').trim();
    if (!url) return reject(new Error('DATABASE_URL is required for Postgres backup.'));
    const child = spawn('pg_dump', ['--format=custom', '--file', targetPath, url], { stdio: 'inherit' });
    child.on('error', (error) => reject(new Error(`Failed to execute pg_dump: ${error.message}`)));
    child.on('exit', (code) => {
      if (code === 0) return resolveOk();
      reject(new Error(`pg_dump exited with code ${code}`));
    });
  });
}

function deriveAes256Key(secret) {
  return createHash('sha256').update(String(secret || ''), 'utf8').digest();
}

async function encryptFileInPlace(sourcePath) {
  const plaintext = await readFile(sourcePath);
  const iv = randomBytes(12);
  const key = deriveAes256Key(BACKUP_ENCRYPTION_KEY);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const output = Buffer.concat([iv, tag, encrypted]);
  const targetPath = `${sourcePath}.enc`;
  await writeFile(targetPath, output);
  if (!KEEP_PLAINTEXT_BACKUPS) {
    await unlink(sourcePath);
  }
  return targetPath;
}

async function run() {
  if (!BACKUP_ENCRYPTION_KEY) {
    const message = 'BACKUP_ENCRYPTION_KEY is required to encrypt backup artifacts.';
    if (IS_PRODUCTION) throw new Error(message);
    console.warn(`[WARN] ${message} Backups will remain plaintext in non-production.`);
  }

  await mkdir(BACKUP_DIR, { recursive: true });
  const ts = stamp();
  const pgBackup = resolve(BACKUP_DIR, `postgres-${ts}.dump`);
  const auditBackup = resolve(BACKUP_DIR, `audit-log-${ts}.ndjson`);

  await runPgDump(pgBackup);
  await mkdir(dirname(auditBackup), { recursive: true });
  await copyFile(AUDIT_LOG_PATH, auditBackup);

  let encryptedPgBackup = null;
  let encryptedAuditBackup = null;
  if (BACKUP_ENCRYPTION_KEY) {
    encryptedPgBackup = await encryptFileInPlace(pgBackup);
    encryptedAuditBackup = await encryptFileInPlace(auditBackup);
  }

  console.log(`backup complete:
  postgres: ${encryptedPgBackup || pgBackup}
  audit:    ${encryptedAuditBackup || auditBackup}
  encrypted:${BACKUP_ENCRYPTION_KEY ? 'yes' : 'no'}`);
}

run().catch((error) => {
  console.error('backup failed', error?.message || error);
  process.exit(1);
});
