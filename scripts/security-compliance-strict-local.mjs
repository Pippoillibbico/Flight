import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const LOCAL_DATABASE_URL = process.env.SECURITY_COMPLIANCE_LOCAL_DATABASE_URL || 'postgresql://flight:flight@127.0.0.1:5432/flight';
const LOCAL_REDIS_URL = process.env.SECURITY_COMPLIANCE_LOCAL_REDIS_URL || 'redis://127.0.0.1:6379';
const KEEP_SERVICES_UP =
  String(process.env.SECURITY_COMPLIANCE_LOCAL_KEEP_SERVICES || 'false')
    .trim()
    .toLowerCase() === 'true';
const LOCAL_DOCKER_CONFIG = process.env.DOCKER_CONFIG || resolve(process.cwd(), '.tmp', 'docker-config');

function spawnStep(label, cmd, args, env = process.env) {
  return new Promise((resolveStep, rejectStep) => {
    console.log(`\n==> ${label}`);
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${cmd} ${args.join(' ')}`], {
            stdio: 'inherit',
            shell: false,
            env
          })
        : spawn(cmd, args, { stdio: 'inherit', shell: false, env });
    child.on('exit', (code) => {
      if (code === 0) return resolveStep();
      return rejectStep(new Error(`${label} failed (${code})`));
    });
  });
}

async function main() {
  await mkdir(LOCAL_DOCKER_CONFIG, { recursive: true });
  const dockerEnv = { ...process.env, DOCKER_CONFIG: LOCAL_DOCKER_CONFIG };
  const strictEnv = {
    ...process.env,
    DATABASE_URL: LOCAL_DATABASE_URL,
    REDIS_URL: LOCAL_REDIS_URL
  };

  await spawnStep('docker compose up -d postgres redis', 'docker', ['compose', 'up', '-d', 'postgres', 'redis'], dockerEnv);
  try {
    await spawnStep('security compliance strict', 'npm', ['run', 'test:security:compliance:strict'], strictEnv);
    console.log('\nsecurity-compliance-strict-local: PASS');
  } finally {
    if (!KEEP_SERVICES_UP) {
      await spawnStep('docker compose stop postgres redis', 'docker', ['compose', 'stop', 'postgres', 'redis'], dockerEnv);
    }
  }
}

main().catch((error) => {
  console.error('\nsecurity-compliance-strict-local: FAIL');
  console.error(error?.message || error);
  process.exit(1);
});
