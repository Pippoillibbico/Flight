import dotenv from 'dotenv';
import { getRuntimeConfigAudit } from '../server/lib/runtime-config.js';
import { evaluateStartupReadiness } from '../server/lib/startup-readiness.js';

dotenv.config();

const audit = getRuntimeConfigAudit(process.env);
const readiness = evaluateStartupReadiness(process.env);
const entries = audit.checks.map((item) => ({
  key: item.key,
  severity: item.severity,
  status: item.ok ? 'OK' : 'MISSING',
  detail: item.detail
}));

for (const item of entries) {
  const tag = item.severity === 'blocking' ? 'P0' : 'P1';
  console.log(`[${item.status}] ${tag} ${item.key} :: ${item.detail}`);
}

console.log(
  JSON.stringify(
    {
      ok: readiness.ok,
      summary: readiness.summary,
      blockingMissing: readiness.blockingFailed,
      recommendedMissing: readiness.recommendedFailed
    },
    null,
    2
  )
);

if (!readiness.ok) process.exit(1);
