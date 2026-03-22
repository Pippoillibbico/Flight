import { readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const DATA_DIR = resolve(process.cwd(), 'data');
const APPLY = process.argv.includes('--apply');
const MAX_CORRUPT_KEEP = Math.max(0, Number(process.env.FLIGHT_DB_CORRUPT_KEEP || 5));
const MAX_SECURITY_KEEP = Math.max(0, Number(process.env.FLIGHT_DB_SECURITY_KEEP || 2));

function matches(name, pattern) {
  return pattern.test(String(name || ''));
}

async function listFiles() {
  const entries = await readdir(DATA_DIR, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

async function byMtimeDesc(names) {
  const rows = await Promise.all(
    names.map(async (name) => {
      const fullPath = resolve(DATA_DIR, name);
      const info = await stat(fullPath).catch(() => null);
      return { name, fullPath, mtimeMs: Number(info?.mtimeMs || 0) };
    })
  );
  return rows.filter((row) => row.fullPath).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function splitRetention(rows, keep) {
  if (keep <= 0) return { keepRows: [], deleteRows: rows };
  return {
    keepRows: rows.slice(0, keep),
    deleteRows: rows.slice(keep)
  };
}

async function main() {
  const files = await listFiles();
  const directDeletePatterns = [/^db\.json\.tmp-/i, /^db\.json\.bak$/i];
  const corruptRows = await byMtimeDesc(files.filter((name) => matches(name, /^db\.json\.corrupt-\d+$/i)));
  const securitySmokeRows = await byMtimeDesc(files.filter((name) => matches(name, /^db-security-smoke-\d+\.json(\.bak)?$/i)));
  const securityComplianceRows = await byMtimeDesc(files.filter((name) => matches(name, /^db-security-compliance-\d+\.json(\.bak)?$/i)));

  const directRows = await byMtimeDesc(files.filter((name) => directDeletePatterns.some((pattern) => pattern.test(name))));
  const { keepRows: keepCorruptRows, deleteRows: deleteCorruptRows } = splitRetention(corruptRows, MAX_CORRUPT_KEEP);
  const { keepRows: keepSecuritySmokeRows, deleteRows: deleteSecuritySmokeRows } = splitRetention(securitySmokeRows, MAX_SECURITY_KEEP);
  const { keepRows: keepSecurityComplianceRows, deleteRows: deleteSecurityComplianceRows } = splitRetention(securityComplianceRows, MAX_SECURITY_KEEP);

  const deleteRows = [
    ...directRows,
    ...deleteCorruptRows,
    ...deleteSecuritySmokeRows,
    ...deleteSecurityComplianceRows
  ];

  console.log(`cleanup-db-artifacts: mode=${APPLY ? 'apply' : 'dry-run'}`);
  console.log(`- data_dir: ${DATA_DIR}`);
  console.log(`- keep_corrupt: ${MAX_CORRUPT_KEEP}`);
  console.log(`- keep_security_reports: ${MAX_SECURITY_KEEP}`);
  console.log(`- files_to_delete: ${deleteRows.length}`);

  if (keepCorruptRows.length > 0) {
    console.log(`- kept_corrupt: ${keepCorruptRows.map((row) => row.name).join(', ')}`);
  }
  if (keepSecuritySmokeRows.length > 0) {
    console.log(`- kept_security_smoke: ${keepSecuritySmokeRows.map((row) => row.name).join(', ')}`);
  }
  if (keepSecurityComplianceRows.length > 0) {
    console.log(`- kept_security_compliance: ${keepSecurityComplianceRows.map((row) => row.name).join(', ')}`);
  }

  if (!APPLY) {
    for (const row of deleteRows) console.log(`  dry-run delete -> ${row.name}`);
    console.log('cleanup-db-artifacts: completed (dry-run)');
    return;
  }

  for (const row of deleteRows) {
    await rm(row.fullPath, { force: true });
    console.log(`  deleted -> ${row.name}`);
  }
  console.log('cleanup-db-artifacts: completed');
}

main().catch((error) => {
  console.error('cleanup-db-artifacts: failed', error?.message || error);
  process.exit(1);
});
