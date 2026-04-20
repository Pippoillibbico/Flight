import 'dotenv/config';

const PLACEHOLDER_PATTERNS = [
  'replace-with',
  'changeme',
  'example.com',
  'your-',
  'todo',
  'dummy',
  'placeholder'
];

function parseCsv(raw) {
  return String(raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function looksPlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function parseMinLengthRules(raw) {
  const rules = new Map();
  for (const item of parseCsv(raw)) {
    const [name, minRaw] = item.split(':').map((part) => String(part || '').trim());
    const min = Number(minRaw);
    if (!name || !Number.isFinite(min) || min <= 0) continue;
    rules.set(name, Math.trunc(min));
  }
  return rules;
}

function parseExactMatchRules(raw) {
  const rules = new Map();
  for (const item of parseCsv(raw)) {
    const [nameRaw, ...valueParts] = item.split(':');
    const name = String(nameRaw || '').trim();
    const expected = String(valueParts.join(':') || '').trim();
    if (!name || !expected) continue;
    rules.set(name, expected);
  }
  return rules;
}

function assertUrl(name, { httpsOnly = false } = {}) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`missing_required_env:${name}`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`invalid_url_env:${name}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`invalid_url_protocol_env:${name}:${parsed.protocol}`);
  }
  if (httpsOnly && parsed.protocol !== 'https:') {
    throw new Error(`https_required_env:${name}`);
  }
}

function run() {
  const required = parseCsv(process.env.REQUIRED_ENV_LIST);
  const urlList = parseCsv(process.env.URL_ENV_LIST);
  const httpsUrlList = parseCsv(process.env.HTTPS_URL_ENV_LIST);
  const minRules = parseMinLengthRules(process.env.MIN_LENGTH_RULES);
  const exactRules = parseExactMatchRules(process.env.EXACT_MATCH_RULES);

  const missing = [];
  const placeholder = [];
  const tooShort = [];
  const exactMismatch = [];

  for (const name of required) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
      missing.push(name);
      continue;
    }
    if (looksPlaceholder(value)) {
      placeholder.push(name);
    }
  }

  for (const [name, min] of minRules.entries()) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
      missing.push(name);
      continue;
    }
    if (value.length < min) {
      tooShort.push(`${name}<${min}`);
    }
  }

  for (const [name, expectedRaw] of exactRules.entries()) {
    const expected = expectedRaw.trim().toLowerCase();
    const actual = String(process.env[name] || '').trim().toLowerCase();
    if (!actual) {
      missing.push(name);
      continue;
    }
    if (actual !== expected) {
      exactMismatch.push(`${name}:${actual}->${expected}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`missing_required_env:${Array.from(new Set(missing)).join(',')}`);
  }
  if (placeholder.length > 0) {
    throw new Error(`placeholder_values_not_allowed:${Array.from(new Set(placeholder)).join(',')}`);
  }
  if (tooShort.length > 0) {
    throw new Error(`env_value_too_short:${tooShort.join(',')}`);
  }
  if (exactMismatch.length > 0) {
    throw new Error(`env_exact_match_failed:${exactMismatch.join(',')}`);
  }

  for (const name of urlList) {
    assertUrl(name, { httpsOnly: false });
  }
  for (const name of httpsUrlList) {
    assertUrl(name, { httpsOnly: true });
  }

  console.log('[validate-workflow-env] OK');
}

try {
  run();
} catch (error) {
  console.error('[validate-workflow-env] FAILED');
  console.error(error?.message || error);
  process.exit(1);
}
