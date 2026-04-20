import 'dotenv/config';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

async function run() {
  const webhook = required('RELEASE_ALERT_WEBHOOK_URL');
  const status = String(process.env.RELEASE_GATE_STATUS || 'failed').trim().toLowerCase();

  const payload = {
    text: `[${String(process.env.GITHUB_REPOSITORY || 'flight-suite')}] release-prod-gate ${status}`,
    status,
    repository: process.env.GITHUB_REPOSITORY || null,
    workflow: process.env.GITHUB_WORKFLOW || null,
    runId: process.env.GITHUB_RUN_ID || null,
    runNumber: process.env.GITHUB_RUN_NUMBER || null,
    actor: process.env.GITHUB_ACTOR || null,
    ref: process.env.GITHUB_REF || null,
    sha: process.env.GITHUB_SHA || null,
    environment: 'production',
    timestamp: new Date().toISOString()
  };

  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`alert_delivery_failed:${response.status}:${text.slice(0, 200)}`);
  }

  console.log('[ci-release-alert] delivered');
}

run().catch((error) => {
  console.error('[ci-release-alert] failed');
  console.error(error?.message || error);
  process.exit(1);
});

