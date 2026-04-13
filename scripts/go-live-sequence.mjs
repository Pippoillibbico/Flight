import { spawn } from 'node:child_process';

function asBool(value) {
  return String(value || '')
    .trim()
    .toLowerCase() === 'true';
}

const GO_LIVE_TEST_ISOLATION_NONE = asBool(process.env.GO_LIVE_TEST_ISOLATION_NONE);
const TEST_ISOLATION_FLAG = '--test-isolation=none';
const GO_LIVE_SKIP_BUILD = asBool(process.env.GO_LIVE_SKIP_BUILD);
const SECURITY_STRICT_SCRIPT = asBool(process.env.GO_LIVE_STRICT_SECURITY_LOCAL)
  ? 'test:security:compliance:strict:local'
  : 'test:security:compliance:strict';

const ciSteps = GO_LIVE_SKIP_BUILD
  ? [
      ['npm', ['run', 'lint']],
      ['npm', ['run', 'lint:providers']],
      ['npm', ['test']]
    ]
  : [['npm', ['run', 'ci']]];

const steps = [
  ...ciSteps,
  ['npx', ['playwright', 'test', 'e2e/ui-final-regression.spec.js']],
  ['npx', ['playwright', 'test', 'e2e/auth-flow-complete.spec.js']],
  ['npm', ['run', 'test:security']],
  ['npm', ['run', SECURITY_STRICT_SCRIPT]],
  ['npm', ['run', 'test:load:gate']],
  ['npm', ['run', 'test:go-live']],
  ['npm', ['run', 'slo:warmup']],
  ['npm', ['run', 'slo:enforce']]
];

if (asBool(process.env.GO_LIVE_SKIP_E2E)) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const [cmd, args] = steps[index];
    const normalizedCmd = String(cmd || '').trim().toLowerCase();
    const normalizedArgs = Array.isArray(args) ? args.map((arg) => String(arg || '').trim().toLowerCase()) : [];
    if (normalizedCmd === 'npx' && normalizedArgs[0] === 'playwright' && normalizedArgs[1] === 'test') {
      steps.splice(index, 1);
    }
  }
}

function appendNodeOption(existing, option) {
  const text = String(existing || '').trim();
  if (!text) return option;
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.includes(option)) return text;
  return `${text} ${option}`.trim();
}

function isNodeTestStep(cmd, args) {
  const lowerCmd = String(cmd || '').trim().toLowerCase();
  const lowerArgs = Array.isArray(args) ? args.map((arg) => String(arg || '').trim().toLowerCase()) : [];
  if (lowerCmd === 'npm' && lowerArgs[0] === 'run' && (lowerArgs[1] === 'ci' || lowerArgs[1] === 'test')) return true;
  if (lowerCmd === 'npm' && lowerArgs[0] === 'test') return true;
  if (lowerCmd === 'node' && lowerArgs.includes('--test')) return true;
  return false;
}

function shouldApplyTestIsolationNone(cmd, args, { force = false } = {}) {
  if (!force && !GO_LIVE_TEST_ISOLATION_NONE) return false;
  return isNodeTestStep(cmd, args);
}

function buildStepEnv(cmd, args, { forceTestIsolationNone = false } = {}) {
  const env = { ...process.env };
  if (shouldApplyTestIsolationNone(cmd, args, { force: forceTestIsolationNone })) {
    env.NODE_OPTIONS = appendNodeOption(env.NODE_OPTIONS, TEST_ISOLATION_FLAG);
  }
  return env;
}

function runStep([cmd, args], { forceTestIsolationNone = false } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const label = `${cmd} ${args.join(' ')}`;
    const retryLabel = forceTestIsolationNone ? ' [retry:test-isolation=none]' : '';
    console.log(`\n==> ${label}${retryLabel}`);
    const env = buildStepEnv(cmd, args, { forceTestIsolationNone });
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${cmd} ${args.join(' ')}`], {
            stdio: 'inherit',
            shell: false,
            env
          })
        : spawn(cmd, args, { stdio: 'inherit', shell: false, env });
    child.on('error', (error) => {
      if (!forceTestIsolationNone && !GO_LIVE_TEST_ISOLATION_NONE && isNodeTestStep(cmd, args)) {
        console.warn(
          `step error on "${label}" (${error?.message || error}); retrying with ${TEST_ISOLATION_FLAG}`
        );
        runStep([cmd, args], { forceTestIsolationNone: true })
          .then((result) => finish(resolve, result))
          .catch((retryError) => finish(reject, retryError));
        return;
      }
      finish(reject, new Error(`Step failed to start: ${label} (${error?.message || error})`));
    });
    child.on('exit', (code) => {
      if (code === 0) return finish(resolve);
      if (!forceTestIsolationNone && !GO_LIVE_TEST_ISOLATION_NONE && isNodeTestStep(cmd, args)) {
        console.warn(`step "${label}" failed (exit=${code}); retrying with ${TEST_ISOLATION_FLAG}`);
        runStep([cmd, args], { forceTestIsolationNone: true })
          .then((result) => finish(resolve, result))
          .catch((retryError) => finish(reject, retryError));
        return;
      }
      return finish(reject, new Error(`Step failed (${code}): ${label}`));
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
