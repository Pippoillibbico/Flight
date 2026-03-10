import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const MEMORY_FILE = resolve(ROOT, 'docs/testing/regression-memory.json');
const REPORT_FILE = resolve(ROOT, 'docs/testing/regression-latest.md');

const STAGES = [
  { id: 'lint', label: 'Lint', command: 'npm', args: ['run', 'lint'] },
  { id: 'lintProviders', label: 'Provider Lint', command: 'npm', args: ['run', 'lint:providers'] },
  { id: 'nodeTests', label: 'Node Tests', command: 'npm', args: ['test'] },
  { id: 'e2e', label: 'E2E Playwright', command: 'npx', args: ['playwright', 'test'] }
];

function nowIso() {
  return new Date().toISOString();
}

function uniq(items) {
  return [...new Set(items.filter(Boolean).map((item) => String(item).trim()))];
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

async function runStage(stage) {
  const startedAt = Date.now();
  const commandLine = `${stage.command} ${stage.args.join(' ')}`;
  process.stdout.write(`\n[stage] ${stage.label}: ${commandLine}\n`);

  return new Promise((resolveStage) => {
    const child = spawn(stage.command, stage.args, {
      cwd: ROOT,
      env: process.env,
      shell: process.platform === 'win32',
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on('close', (code) => {
      const combined = `${stdout}\n${stderr}`;
      const exitCode = Number(code || 0);
      resolveStage({
        id: stage.id,
        label: stage.label,
        command: commandLine,
        exitCode,
        durationMs: Date.now() - startedAt,
        failures: exitCode !== 0 ? parseStageFailures(stage.id, combined) : [],
        output: combined
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
  return stageResults.filter((stage) => stage.exitCode !== 0).length;
}

function buildFailureRows(stageResults) {
  const rows = [];
  for (const stage of stageResults) {
    if (stage.exitCode === 0) continue;
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
      failureCount: stage.failures.length
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
    lines.push(`- ${stage.label}: exit=${stage.exitCode}, failures=${stage.failureCount}, durationMs=${stage.durationMs}`);
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
  for (const stage of STAGES) {
    const result = await runStage(stage);
    stageResults.push(result);
    if (result.exitCode !== 0) {
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
