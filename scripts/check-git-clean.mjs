import { spawnSync } from 'node:child_process';

const gitExecutable =
  process.env.GIT_EXE ||
  (process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : 'git');

const result = spawnSync(gitExecutable, ['status', '--porcelain', '--untracked-files=no'], {
  encoding: 'utf8',
  shell: false
});

if (result.error) {
  const isCi = String(process.env.CI || '')
    .trim()
    .toLowerCase() === 'true';
  const errCode = String(result.error?.code || '').trim().toUpperCase();
  if (!isCi && errCode === 'EPERM') {
    console.warn('[check-git-clean] skipped locally due to EPERM while spawning git executable');
    process.exit(0);
  }
  console.error('[check-git-clean] failed to execute git status');
  console.error(result.error.message || result.error);
  process.exit(1);
}

if ((result.status ?? 1) !== 0) {
  console.error('[check-git-clean] git status failed');
  console.error(result.stderr || '');
  process.exit(result.status || 1);
}

const dirtyLines = String(result.stdout || '')
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter(Boolean);

if (dirtyLines.length > 0) {
  console.error('[check-git-clean] tracked files modified during pipeline');
  for (const line of dirtyLines.slice(0, 50)) {
    console.error(`- ${line}`);
  }
  process.exit(1);
}

console.log('[check-git-clean] OK');
