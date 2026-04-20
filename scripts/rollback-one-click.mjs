import 'dotenv/config';
import { spawn } from 'node:child_process';

function runCommand(command, name) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      stdio: 'inherit',
      shell: true,
      env: process.env
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`step_failed:${name}`));
    });
    child.on('error', reject);
  });
}

async function run() {
  const rollbackCommand = String(process.env.ROLLBACK_DEPLOY_COMMAND || '').trim();
  if (!rollbackCommand) {
    throw new Error(
      'ROLLBACK_DEPLOY_COMMAND is required (example: "kubectl rollout undo deploy/flight-api -n prod")'
    );
  }

  console.log('[rollback] running deployment rollback command');
  await runCommand(rollbackCommand, 'rollback-deploy');

  const postRollbackVerify = String(process.env.ROLLBACK_POST_VERIFY_COMMAND || '').trim();
  if (postRollbackVerify) {
    console.log('[rollback] running post-rollback verification command');
    await runCommand(postRollbackVerify, 'rollback-post-verify');
  } else if (String(process.env.PROD_BASE_URL || '').trim()) {
    console.log('[rollback] running external production audit');
    await runCommand('npm run test:prod:external', 'rollback-prod-external-audit');
  } else {
    console.log('[rollback] post verification skipped (set ROLLBACK_POST_VERIFY_COMMAND or PROD_BASE_URL)');
  }

  console.log('[rollback] completed successfully');
}

run().catch((error) => {
  console.error('[rollback] failed');
  console.error(error?.message || error);
  process.exit(1);
});

