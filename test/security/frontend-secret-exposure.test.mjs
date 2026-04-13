import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FRONTEND_ROOT = resolve(process.cwd(), 'src');
const FORBIDDEN_PATTERNS = [
  /process\.env\.(JWT_SECRET|OPENAI_API_KEY|ANTHROPIC_API_KEY|CLAUDE_API_KEY|STRIPE_SECRET_KEY|BT_PRIVATE_KEY|INTERNAL_INGEST_TOKEN)/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/
];
const ALLOWED_PUBLIC_ENV_PATTERN = /import\.meta\.env\.VITE_[A-Z0-9_]+/g;

function walkFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current);
    for (const entry of entries) {
      const absolute = join(current, entry);
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(entry)) continue;
      out.push(absolute);
    }
  }
  return out;
}

test('frontend source does not embed server/provider secrets', () => {
  const files = walkFiles(FRONTEND_ROOT);
  const violations = [];
  for (const filePath of files) {
    const raw = readFileSync(filePath, 'utf8');
    const normalized = raw.replace(ALLOWED_PUBLIC_ENV_PATTERN, 'VITE_PUBLIC_ENV');
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (!pattern.test(normalized)) continue;
      violations.push({ filePath, pattern: String(pattern) });
    }
  }

  assert.deepEqual(violations, []);
});

