import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const errorPath = resolve(root, 'data', 'logs', 'error.log');
const securityPath = resolve(root, 'data', 'logs', 'security.log');

function tailLines(text, n = 40) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter(Boolean);
  return lines.slice(Math.max(0, lines.length - n));
}

async function safeRead(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function summarize(lines, name) {
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {}
  }
  const byMsg = new Map();
  for (const row of parsed) {
    const key = String(row.msg || 'unknown');
    byMsg.set(key, (byMsg.get(key) || 0) + 1);
  }
  const top = [...byMsg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`\n== ${name} (last ${lines.length} lines) ==`);
  if (top.length === 0) {
    console.log('No structured entries found.');
    return;
  }
  for (const [msg, count] of top) {
    console.log(`${count}x  ${msg}`);
  }
}

async function run() {
  const [errorLog, securityLog] = await Promise.all([safeRead(errorPath), safeRead(securityPath)]);
  const errorLines = tailLines(errorLog, 80);
  const securityLines = tailLines(securityLog, 80);
  summarize(errorLines, 'Error Log');
  summarize(securityLines, 'Security Log');
}

run().catch((error) => {
  console.error('show-report failed:', error?.message || error);
  process.exit(1);
});
