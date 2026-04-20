import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT_DIRS = ['server', 'src', 'scripts'];
const EXTENSIONS = new Set(['.js', '.mjs', '.jsx', '.ts', '.tsx']);
const ALLOWED_CONTEXT = ['docs', 'readme', 'comment', 'template', 'blocked_terms', 'const banned ='];
const ALLOWED_PROVIDER_FILES = new Set([
  'server/lib/providers/duffel-provider.js',
  'server/lib/providers/provider-registry.js',
  'server/lib/runtime-config.js',
  'server/routes/system.js'
]);
const BLOCKED_TERMS = [
  'skyscanner',
  'google flights',
  'tequila',
  'kiwi.com',
  'sabre',
  'rapidapi',
  'serpapi'
];

function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/').toLowerCase();
}

function hasAllowedContext(path, line) {
  const normalizedPath = normalizePath(path);
  if (ALLOWED_PROVIDER_FILES.has(normalizedPath)) return true;
  const lower = `${normalizedPath} ${line}`.toLowerCase();
  if (lower.includes('check-no-external-providers.mjs')) return true;
  return ALLOWED_CONTEXT.some((token) => lower.includes(token));
}

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
      continue;
    }
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (EXTENSIONS.has(ext)) out.push(full);
  }
  return out;
}

async function run() {
  const files = [];
  for (const dir of ROOT_DIRS) {
    files.push(...(await walk(dir)));
  }

  const violations = [];
  for (const file of files) {
    const normalizedFile = normalizePath(file);
    const content = await readFile(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      const normalized = line.toLowerCase();
      for (const term of BLOCKED_TERMS) {
        if (!normalized.includes(term)) continue;
        if (hasAllowedContext(normalizedFile, line)) continue;
        violations.push(`${file}:${idx + 1}: ${line.trim()}`);
      }
    });
  }

  if (violations.length > 0) {
    console.error('check-no-external-providers: FAILED');
    for (const item of violations) console.error(`- ${item}`);
    process.exit(1);
  }

  console.log(`check-no-external-providers: OK (${files.length} files scanned)`);
}

run().catch((error) => {
  console.error('check-no-external-providers: ERROR');
  console.error(error?.message || error);
  process.exit(1);
});
