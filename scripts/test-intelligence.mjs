import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const MEMORY_FILE = resolve(ROOT, 'docs/testing/regression-memory.json');
const REPORT_FILE = resolve(ROOT, 'docs/testing/regression-latest.md');
const TEST_ISOLATION_FLAG = '--test-isolation=none';
const OUTPUT_CAPTURE_MAX = 2_000_000;

function asBool(value) {
  return String(value || '')
    .trim()
    .toLowerCase() === 'true';
}

const TEST_INTELLIGENCE_TEST_ISOLATION_NONE = asBool(process.env.TEST_INTELLIGENCE_TEST_ISOLATION_NONE);
const TEST_INTELLIGENCE_SKIP_E2E = asBool(process.env.TEST_INTELLIGENCE_SKIP_E2E);
const TEST_INTELLIGENCE_ALLOW_E2E_SPAWN_EPERM_SKIP =
  process.env.TEST_INTELLIGENCE_ALLOW_E2E_SPAWN_EPERM_SKIP == null
    ? true
    : asBool(process.env.TEST_INTELLIGENCE_ALLOW_E2E_SPAWN_EPERM_SKIP);

const STAGES = [
  { id: 'lint', label: 'Lint', command: 'npm', args: ['run', 'lint'] },
  { id: 'lintProviders', label: 'Provider Lint', command: 'npm', args: ['run', 'lint:providers'] },
  { id: 'nodeTests', label: 'Node Tests', command: 'npm', args: ['test'] },
  { id: 'e2e', label: 'E2E Playwright', command: 'npx', args: ['playwright', 'test'] }
];

const ACTIVE_STAGES = TEST_INTELLIGENCE_SKIP_E2E ? STAGES.filter((stage) => stage.id !== 'e2e') : STAGES;

function isE2eSpawnEperm(stage, message) {
  if (String(stage?.id || '') !== 'e2e') return false;
  const text = String(message || '').toLowerCase();
  return text.includes('spawn eperm') || text.includes(' eperm');
}

function appendCapturedOutput(current, chunkText) {
  const next = `${current}${chunkText}`;
  if (next.length <= OUTPUT_CAPTURE_MAX) return next;
  return next.slice(next.length - OUTPUT_CAPTURE_MAX);
}

function nowIso() {
  return new Date().toISOString();
}

function uniq(items) {
  return [...new Set(items.filter(Boolean).map((item) => String(item).trim()))];
}

function appendNodeOption(existing, option) {
  const text = String(existing || '').trim();
  if (!text) return option;
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.includes(option)) return text;
  return `${text} ${option}`.trim();
}

function buildStageEnv(stage, { forceTestIsolationNone = false } = {}) {
  const env = { ...process.env };
  if ((forceTestIsolationNone || TEST_INTELLIGENCE_TEST_ISOLATION_NONE) && String(stage?.id || '') === 'nodeTests') {
    env.NODE_OPTIONS = appendNodeOption(env.NODE_OPTIONS, TEST_ISOLATION_FLAG);
  }
  return env;
}

function parsePlaywrightFailures(output) {
  const lines = String(output || '').split(/\r?\n/);
  const signatures = [];
  for (const line of lines) {
    let match = line.match(/^\s*\d+\)\s+\[[^\]]+\]\s+(?:›|>|â€º)\s+(.+)$/u);
    if (match) {
      signatures.push(match[1]);
      continue;
    }
    match = line.match(/^\s*\[[^\]]+\]\s+(?:›|>|â€º)\s+(.+)$/u);
    if (match) {
      signatures.push(match[1]);
    }
  }
  return uniq(signatures);
}

function parseNodeFailures(output) {
  const lines = String(output || '').split(/\r?\n/);
  const signatures = [];
  let pendingLocation = '';
  for (const line of lines) {
    const location = line.match(/^\s*test at (.+)$/);
    if (location) {
      pendingLocation = location[1];
      continue;
    }
    const fail = line.match(/^\s*(?:✖|x|âœ–)\s(.+?)(?:\s\(\d+(\.\d+)?ms\))?\s*$/u);
    if (fail) {
      signatures.push(pendingLocation ? `${fail[1]} @ ${pendingLocation}` : fail[1]);
      pendingLocation = '';
      continue;
    }
    const tapFail = line.match(/^\s*not ok\s+\d+\s+-\s+(.+)\s*$/i);
    if (tapFail) {
      signatures.push(tapFail[1]);
    }
  }
  return uniq(signatures);
}

function parseStageFailures(stageId, output) {
  const parsed = stageId === 'e2e' ? parsePlaywrightFailures(output) : stageId === 'nodeTests' ? parseNodeFailures(output) : [];
  if (parsed.length > 0) return parsed;
  const fallback = String(output || '')
    .split(/\r?\n/)
    .find((line) => /error|failed|failure|not ok/i.test(line));
  return fallback ? [fallback.trim()] : [];
}

function shouldRetryNodeTestsWithIsolation(stage) {
  return String(stage?.id || '') === 'nodeTests' && !TEST_INTELLIGENCE_TEST_ISOLATION_NONE;
}

async function runStage(stage, { forceTestIsolationNone = false } = {}) {
  const startedAt = Date.now();
  const commandLine = `${stage.command} ${stage.args.join(' ')}`;
  const retryLabel = forceTestIsolationNone ? ` [retry:${TEST_ISOLATION_FLAG}]` : '';
  process.stdout.write(`\n[stage] ${stage.label}: ${commandLine}${retryLabel}\n`);
  const env = buildStageEnv(stage, { forceTestIsolationNone });

  return new Promise((resolveStage) => {
    let combined = '';
    const captureOutput = String(stage?.id || '') === 'e2e';
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolveStage(result);
    };
    let child;
    try {
      child =
        process.platform === 'win32'
          ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
              cwd: ROOT,
              env,
              shell: false,
              stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
              windowsHide: true
            })
          : spawn(stage.command, stage.args, {
              cwd: ROOT,
              env,
              shell: false,
              stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
              windowsHide: true
            });
    } catch (error) {
      const errorMessage = error?.message || String(error);
      if (TEST_INTELLIGENCE_ALLOW_E2E_SPAWN_EPERM_SKIP && isE2eSpawnEperm(stage, errorMessage)) {
        settle({
          id: stage.id,
          label: stage.label,
          command: commandLine,
          exitCode: 0,
          durationMs: Date.now() - startedAt,
          failures: [],
          output: '',
          skipped: true,
          skipReason: `infra_blocked:${errorMessage}`
        });
        return;
      }
      settle({
        id: stage.id,
        label: stage.label,
        command: commandLine,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        failures: [`spawn_error:${errorMessage}`],
        output: `spawn_error:${errorMessage}`,
        skipped: false,
        skipReason: null
      });
      return;
    }
    if (captureOutput && child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = String(chunk || '');
        if (text) process.stdout.write(text);
        combined = appendCapturedOutput(combined, text);
      });
    }
    if (captureOutput && child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = String(chunk || '');
        if (text) process.stderr.write(text);
        combined = appendCapturedOutput(combined, text);
      });
    }
    child.on('error', (error) => {
      const errorMessage = error?.message || String(error);
      if (TEST_INTELLIGENCE_ALLOW_E2E_SPAWN_EPERM_SKIP && isE2eSpawnEperm(stage, errorMessage)) {
        settle({
          id: stage.id,
          label: stage.label,
          command: commandLine,
          exitCode: 0,
          durationMs: Date.now() - startedAt,
          failures: [],
          output: '',
          skipped: true,
          skipReason: `infra_blocked:${errorMessage}`
        });
        return;
      }
      if (!forceTestIsolationNone && shouldRetryNodeTestsWithIsolation(stage)) {
        process.stdout.write(
          `\n[stage] ${stage.label} spawn error (${errorMessage}), retrying with ${TEST_ISOLATION_FLAG}\n`
        );
        runStage(stage, { forceTestIsolationNone: true }).then((retryResult) => settle(retryResult));
        return;
      }
      settle({
        id: stage.id,
        label: stage.label,
        command: commandLine,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        failures: [`spawn_error:${errorMessage}`],
        output: `spawn_error:${errorMessage}`,
        skipped: false,
        skipReason: null
      });
    });
    child.on('close', (code) => {
      const exitCode = Number(code || 0);
      if (exitCode !== 0 && TEST_INTELLIGENCE_ALLOW_E2E_SPAWN_EPERM_SKIP && isE2eSpawnEperm(stage, combined)) {
        settle({
          id: stage.id,
          label: stage.label,
          command: commandLine,
          exitCode: 0,
          durationMs: Date.now() - startedAt,
          failures: [],
          output: combined,
          skipped: true,
          skipReason: 'infra_blocked:spawn_eperm'
        });
        return;
      }
      if (exitCode !== 0 && !forceTestIsolationNone && shouldRetryNodeTestsWithIsolation(stage)) {
        process.stdout.write(
          `\n[stage] ${stage.label} failed (exit=${exitCode}), retrying with ${TEST_ISOLATION_FLAG}\n`
        );
        runStage(stage, { forceTestIsolationNone: true }).then((retryResult) => settle(retryResult));
        return;
      }
      const failures = exitCode !== 0 ? parseStageFailures(stage.id, combined) : [];
      if (exitCode !== 0 && failures.length === 0) {
        failures.push(`${stage.label} failed (exit=${exitCode})`);
      }
      settle({
        id: stage.id,
        label: stage.label,
        command: commandLine,
        exitCode,
        durationMs: Date.now() - startedAt,
        failures,
        output: combined,
        skipped: false,
        skipReason: null
      });
    });
  });
}

async function readMemory() {
  try {
    const raw = await readFile(MEMORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.knownRegressions)) parsed.knownRegressions = [];
    return parsed;
  } catch {
    return {
      schemaVersion: 1,
      updatedAt: null,
      lastRun: null,
      knownRegressions: []
    };
  }
}

function stageFailCount(stageResults) {
  return stageResults.filter((stage) => stage.exitCode !== 0 && !stage.skipped).length;
}

function buildFailureRows(stageResults) {
  const rows = [];
  for (const stage of stageResults) {
    if (stage.exitCode === 0 || stage.skipped) continue;
    for (const signature of stage.failures) {
      rows.push({
        stage: stage.id,
        signature
      });
    }
  }
  return rows;
}

function updateRegressionMemory(memory, stageResults) {
  const timestamp = nowIso();
  const currentFailures = buildFailureRows(stageResults);
  const activeKeys = new Set(currentFailures.map((item) => `${item.stage}::${item.signature}`));
  const knownByKey = new Map(
    (memory.knownRegressions || []).map((entry) => [`${entry.stage}::${entry.signature}`, entry])
  );

  for (const item of currentFailures) {
    const key = `${item.stage}::${item.signature}`;
    const existing = knownByKey.get(key);
    if (!existing) {
      knownByKey.set(key, {
        stage: item.stage,
        signature: item.signature,
        firstSeen: timestamp,
        lastSeen: timestamp,
        occurrences: 1,
        status: 'open',
        fixedAt: null
      });
      continue;
    }
    existing.lastSeen = timestamp;
    existing.occurrences = Number(existing.occurrences || 0) + 1;
    existing.status = 'open';
    existing.fixedAt = null;
  }

  for (const [key, entry] of knownByKey.entries()) {
    if (!activeKeys.has(key) && entry.status === 'open') {
      entry.status = 'fixed';
      entry.fixedAt = timestamp;
    }
  }

  const openRegressions = [...knownByKey.values()].filter((entry) => entry.status === 'open');
  const overallStatus = stageFailCount(stageResults) === 0 ? 'green' : 'red';

  memory.schemaVersion = 1;
  memory.updatedAt = timestamp;
  memory.lastRun = {
    executedAt: timestamp,
    status: overallStatus,
    failedStages: stageFailCount(stageResults),
    openRegressions: openRegressions.length,
    stageResults: stageResults.map((stage) => ({
      id: stage.id,
      label: stage.label,
      command: stage.command,
      exitCode: stage.exitCode,
      durationMs: stage.durationMs,
      failureCount: stage.failures.length,
      skipped: Boolean(stage.skipped),
      skipReason: stage.skipReason || null
    }))
  };
  memory.knownRegressions = [...knownByKey.values()].sort((a, b) =>
    `${a.stage}::${a.signature}`.localeCompare(`${b.stage}::${b.signature}`)
  );

  return memory;
}

async function writeRegressionReport(memory) {
  const lines = [];
  const run = memory.lastRun;
  const open = (memory.knownRegressions || []).filter((entry) => entry.status === 'open');
  const fixed = (memory.knownRegressions || []).filter((entry) => entry.status === 'fixed');
  const skippedStages = (run?.stageResults || []).filter((stage) => stage.skipped);

  lines.push('# Regression Latest');
  lines.push('');
  lines.push(`- Run: ${run?.executedAt || '-'}`);
  lines.push(`- Status: ${run?.status || '-'}`);
  lines.push(`- Failed stages: ${run?.failedStages ?? '-'}`);
  lines.push(`- Open regressions: ${open.length}`);
  lines.push(`- Fixed regressions (history): ${fixed.length}`);
  lines.push('');
  lines.push('## Stage Summary');
  lines.push('');
  for (const stage of run?.stageResults || []) {
    const status = stage.skipped ? 'skipped' : stage.exitCode === 0 ? 'pass' : 'fail';
    const skip = stage.skipped && stage.skipReason ? `, reason=${stage.skipReason}` : '';
    lines.push(`- ${stage.label}: status=${status}, exit=${stage.exitCode}, failures=${stage.failureCount}, durationMs=${stage.durationMs}${skip}`);
  }

  lines.push('');
  lines.push('## Skipped Stages');
  lines.push('');
  if (skippedStages.length === 0) {
    lines.push('- None');
  } else {
    for (const stage of skippedStages) {
      lines.push(`- ${stage.label}: ${stage.skipReason || 'n/a'}`);
    }
  }

  lines.push('');
  lines.push('## Open Regressions');
  lines.push('');
  if (open.length === 0) {
    lines.push('- None');
  } else {
    for (const entry of open) {
      lines.push(`- [${entry.stage}] ${entry.signature} (firstSeen=${entry.firstSeen}, occurrences=${entry.occurrences})`);
    }
  }

  await mkdir(dirname(REPORT_FILE), { recursive: true });
  await writeFile(REPORT_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const stageResults = [];
  for (const stage of ACTIVE_STAGES) {
    const result = await runStage(stage);
    stageResults.push(result);
    if (result.skipped) {
      process.stdout.write(`\n[stage] ${stage.label} skipped (${result.skipReason || 'skip'})\n`);
    } else if (result.exitCode !== 0) {
      process.stdout.write(`\n[stage] ${stage.label} failed with exit code ${result.exitCode}\n`);
    }
  }

  const memory = await readMemory();
  const updated = updateRegressionMemory(memory, stageResults);
  await mkdir(dirname(MEMORY_FILE), { recursive: true });
  await writeFile(MEMORY_FILE, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  await writeRegressionReport(updated);

  const hasFailures = stageFailCount(stageResults) > 0;
  process.stdout.write(
    `\n[test-intelligence] status=${hasFailures ? 'red' : 'green'} | openRegressions=${updated.lastRun?.openRegressions || 0}\n`
  );
  if (hasFailures) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[test-intelligence] fatal error:', error);
  process.exitCode = 1;
});
