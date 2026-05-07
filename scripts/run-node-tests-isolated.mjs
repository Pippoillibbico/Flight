import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { buildTestSafeEnv, ensureTestInfra, ensureTestMigrations, stopTestInfra } from './lib/test-infra.mjs';

function parseArgs() {
  const raw = process.argv.slice(2);
  const splitIndex = raw.indexOf('--');
  if (splitIndex === -1) {
    return raw;
  }
  return raw.slice(splitIndex + 1);
}

function runCommand(command, args, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      env,
      windowsHide: true
    });

    child.on('close', (code) => resolveRun(Number(code || 0)));
    child.on('error', rejectRun);
  });
}

async function main() {
  const commandArgs = parseArgs();
  if (commandArgs.length === 0) {
    console.error('[run-node-tests-isolated] Missing command. Usage: node scripts/run-node-tests-isolated.mjs -- <cmd> [args]');
    process.exit(1);
  }

  const [command, ...args] = commandArgs;
  const tmpRoot = await mkdtemp(resolve(tmpdir(), 'flight-tests-'));
  const dbFile = resolve(tmpRoot, `db-${process.pid}.json`);
  const auditFile = resolve(tmpRoot, `audit-${process.pid}.ndjson`);

  const managedExternally = String(process.env.TEST_INFRA_MANAGED_EXTERNALLY || '').trim().toLowerCase() === 'true';
  const infra = managedExternally ? null : await ensureTestInfra();
  const env = buildTestSafeEnv(process.env, infra || {});
  if (!managedExternally) {
    env.TEST_INFRA_MANAGED_EXTERNALLY = 'true';
  }
  env.FLIGHT_DB_FILE = dbFile;
  env.AUDIT_LOG_FILE = auditFile;

  await ensureTestMigrations(env);

  const commandEnv = {
    ...env,
    FLIGHT_DB_FILE: dbFile,
    AUDIT_LOG_FILE: auditFile
  };

  let exitCode = 1;
  try {
    exitCode = await runCommand(command, args, commandEnv);
  } finally {
    await rm(dirname(dbFile), { recursive: true, force: true }).catch(() => {});
    if (!managedExternally) await stopTestInfra();
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('[run-node-tests-isolated] failed');
  console.error(error?.message || error);
  process.exit(1);
});
