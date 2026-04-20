import { spawn } from 'node:child_process';

const steps = [
  { name: 'lint', cmd: 'npm', args: ['run', 'lint'] },
  { name: 'lint-providers', cmd: 'npm', args: ['run', 'lint:providers'] },
  { name: 'unit-tests', cmd: 'npm', args: ['test'] },
  { name: 'typed-tests', cmd: 'npm', args: ['run', 'test:unit'] },
  { name: 'security-smoke', cmd: 'npm', args: ['run', 'test:security'] },
  { name: 'security-compliance', cmd: 'npm', args: ['run', 'test:security:compliance'] },
  { name: 'build', cmd: 'npm', args: ['run', 'build'] },
  { name: 'ops-prod-readiness', cmd: 'npm', args: ['run', 'ops:prod:readiness'] },
  { name: 'git-clean', cmd: 'npm', args: ['run', 'ci:git-clean'] }
];

if (String(process.env.RUN_DB_MIGRATION_AUDIT || '').trim().toLowerCase() === 'true') {
  steps.push({
    name: 'db-migration-status',
    cmd: 'npm',
    args: ['run', 'db:migrations:status']
  });
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.cmd, step.args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`step_failed:${step.name}`));
    });
    child.on('error', reject);
  });
}

for (const step of steps) {
  // Keep output concise and searchable in CI logs.
  console.log(`\n[release-prod-gate] running: ${step.name}`);
  await runStep(step);
}

console.log('\n[release-prod-gate] all checks passed');
