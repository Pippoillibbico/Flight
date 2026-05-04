import { readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const dataDir = resolve(root, 'data');
const retainDays = Math.max(1, Number(process.env.ANALYTICS_RETENTION_DAYS || 180));
const cutoffMs = Date.now() - retainDays * 24 * 60 * 60 * 1000;
const apply = process.argv.includes('--apply');

function isAnalyticsArtifact(name) {
  const value = String(name || '').toLowerCase();
  return value.includes('analytics') || value.includes('telemetry') || value.includes('outbound');
}

async function main() {
  const entries = await readdir(dataDir, { withFileTypes: true }).catch(() => []);
  const candidates = entries.filter((entry) => entry.isFile() && isAnalyticsArtifact(entry.name));
  const deletions = [];

  for (const entry of candidates) {
    const fullPath = resolve(dataDir, entry.name);
    const info = await stat(fullPath).catch(() => null);
    if (!info) continue;
    if (Number(info.mtimeMs || 0) < cutoffMs) deletions.push({ name: entry.name, fullPath });
  }

  console.log(`cleanup-analytics: mode=${apply ? 'apply' : 'dry-run'} retention_days=${retainDays} files=${deletions.length}`);
  for (const file of deletions) {
    if (!apply) {
      console.log(`dry-run delete -> ${file.name}`);
      continue;
    }
    await rm(file.fullPath, { force: true });
    console.log(`deleted -> ${file.name}`);
  }
}

main().catch((error) => {
  console.error('cleanup-analytics failed:', error?.message || error);
  process.exit(1);
});
