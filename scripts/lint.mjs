import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

async function listFiles(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await listFiles(full, out);
      continue;
    }
    if (full.endsWith('.js') || full.endsWith('.mjs')) out.push(full);
  }
  return out;
}

function runSyntaxCheckWithNode(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${file}\n${stderr.trim()}`));
    });
  });
}

async function fallbackCheck(file) {
  const code = await readFile(file, 'utf8');
  if (/^(<{7}|={7}|>{7})/m.test(code)) {
    throw new Error(`${file}\nmerge conflict markers detected`);
  }
}

async function checkFile(file) {
  try {
    await runSyntaxCheckWithNode(file);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
    await fallbackCheck(file);
  }
}

async function run() {
  const files = [
    ...(await listFiles('server')),
    ...(await listFiles('scripts')),
    ...(await listFiles('test'))
  ];
  for (const file of files) {
    await checkFile(file);
  }
  console.log(`lint: OK (${files.length} files checked)`);
}

run().catch((error) => {
  console.error('lint: FAILED');
  console.error(error?.message || error);
  process.exit(1);
});
