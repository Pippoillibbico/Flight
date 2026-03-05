import { spawn } from 'node:child_process';

const steps = [
  ['npm', ['run', 'ci']],
  ['npx', ['playwright', 'test', 'e2e/ui-final-regression.spec.js']],
  ['npx', ['playwright', 'test', 'e2e/auth-flow-complete.spec.js']],
  ['npm', ['run', 'test:security']],
  ['npm', ['run', 'test:security:compliance']],
  ['npm', ['run', 'test:go-live']],
  ['npm', ['run', 'slo:enforce']]
];

function runStep([cmd, args]) {
  return new Promise((resolve, reject) => {
    const label = `${cmd} ${args.join(' ')}`;
    console.log(`\n==> ${label}`);
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${cmd} ${args.join(' ')}`], {
            stdio: 'inherit',
            shell: false,
            env: process.env
          })
        : spawn(cmd, args, { stdio: 'inherit', shell: false, env: process.env });
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      return reject(new Error(`Step failed (${code}): ${label}`));
    });
  });
}

async function main() {
  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop
    await runStep(step);
  }
  console.log('\ngo-live-sequence: PASS');
}

main().catch((error) => {
  console.error('go-live-sequence: FAIL');
  console.error(error?.message || error);
  process.exit(1);
});
