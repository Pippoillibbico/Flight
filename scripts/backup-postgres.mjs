import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AUDIT_LOG_PATH = fileURLToPath(new URL('../data/audit-log.ndjson', import.meta.url));
const BACKUP_DIR = resolve(process.cwd(), process.env.BACKUP_DIR || 'backups');

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

async function run() {
  await mkdir(BACKUP_DIR, { recursive: true });
  const ts = stamp();
  const pgBackup = resolve(BACKUP_DIR, `postgres-${ts}.dump`);
  const auditBackup = resolve(BACKUP_DIR, `audit-log-${ts}.ndjson`);

  await runPgDump(pgBackup);
  await mkdir(dirname(auditBackup), { recursive: true });
  await copyFile(AUDIT_LOG_PATH, auditBackup);

  console.log(`backup complete:
  postgres: ${pgBackup}
  audit:    ${auditBackup}`);
}

run().catch((error) => {
  console.error('backup failed', error?.message || error);
  process.exit(1);
});

