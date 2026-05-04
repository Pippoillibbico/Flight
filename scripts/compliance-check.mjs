import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const requiredDocs = [
  'docs/privacy/privacy-policy.md',
  'docs/privacy/cookie-policy.md',
  'docs/privacy/registro-trattamenti.md',
  'docs/privacy/data-retention-policy.md',
  'docs/privacy/dpa-fornitori.md',
  'docs/privacy/go-live-compliance-checklist.md',
  'docs/security/data-breach-72h-procedure.md'
];

const requiredCodeFiles = [
  'server/lib/consent-service.js',
  'server/lib/export-security.js',
  'server/routes/outbound.js',
  'server/routes/user-export.js',
  'server/backoffice.js',
  'server/lib/db.js'
];

const requiredScripts = ['scripts/cleanup-logs.mjs', 'scripts/cleanup-analytics.mjs', 'scripts/cleanup-sessions.mjs'];

async function fileExists(path) {
  try {
    await access(resolve(process.cwd(), path), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function includesAll(text, patterns) {
  return patterns.every((pattern) => pattern.test(text));
}

async function run() {
  const errors = [];

  for (const path of requiredDocs) {
    const exists = await fileExists(path);
    if (!exists) {
      errors.push(`missing_doc:${path}`);
      continue;
    }
    const body = await readFile(resolve(process.cwd(), path), 'utf8');
    const okMeta = includesAll(body, [/^Last update:/im, /^Version:/im, /^Owner:/im]);
    if (!okMeta) errors.push(`invalid_doc_metadata:${path}`);
  }

  for (const path of requiredCodeFiles) {
    if (!(await fileExists(path))) errors.push(`missing_code:${path}`);
  }
  for (const path of requiredScripts) {
    if (!(await fileExists(path))) errors.push(`missing_retention_script:${path}`);
  }

  const consentService = await readFile(resolve(process.cwd(), 'server/lib/consent-service.js'), 'utf8');
  if (!/export function canTrack\(/.test(consentService)) errors.push('missing_canTrack_function');

  const outboundRoute = await readFile(resolve(process.cwd(), 'server/routes/outbound.js'), 'utf8');
  if (!/canTrack\(req,\s*['"]analytics['"]\)/.test(outboundRoute)) errors.push('missing_canTrack_enforcement_outbound');

  const exportSecurity = await readFile(resolve(process.cwd(), 'server/lib/export-security.js'), 'utf8');
  if (!/x-export-reason/.test(exportSecurity)) errors.push('missing_export_reason_guard');
  if (!/buildExportAuditEvent/.test(exportSecurity)) errors.push('missing_export_audit_builder');

  const userExportRoute = await readFile(resolve(process.cwd(), 'server/routes/user-export.js'), 'utf8');
  if (!/requireExportReason/.test(userExportRoute)) errors.push('missing_export_reason_user_export');

  const backoffice = await readFile(resolve(process.cwd(), 'server/backoffice.js'), 'utf8');
  if (!/appendImmutableAudit/.test(backoffice)) errors.push('missing_backoffice_audit_log');

  const dbLib = await readFile(resolve(process.cwd(), 'server/lib/db.js'), 'utf8');
  if (!/DATA_RETENTION_AUTH_EVENTS_DAYS/.test(dbLib)) errors.push('missing_retention_config_auth');
  if (!/DATA_RETENTION_CLIENT_TELEMETRY_DAYS/.test(dbLib)) errors.push('missing_retention_config_telemetry');
  if (!/DATA_RETENTION_OUTBOUND_EVENTS_DAYS/.test(dbLib)) errors.push('missing_retention_config_outbound');

  if (errors.length > 0) {
    console.error('[compliance-check] FAILED');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log('[compliance-check] PASS');
}

run().catch((error) => {
  console.error('[compliance-check] ERROR', error?.message || error);
  process.exit(1);
});
