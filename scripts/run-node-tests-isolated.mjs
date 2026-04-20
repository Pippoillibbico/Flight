import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

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

  const env = {
    ...process.env,
    FLIGHT_DB_FILE: dbFile,
    AUDIT_LOG_FILE: auditFile
  };

  try {
    const exitCode = await runCommand(command, args, env);
    process.exit(exitCode);
  } finally {
    await rm(dirname(dbFile), { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error('[run-node-tests-isolated] failed');
  console.error(error?.message || error);
  process.exit(1);
});
