const initial = () => ({
  emails_attempted_by_plan: {},
  emails_sent_by_plan: {},
  emails_skipped_no_value: 0,
  emails_skipped_preferences: 0,
  emails_skipped_not_ready: 0,
  email_delivery_failed: 0,
  free_email_digest_sent: 0
});

let metrics = initial();

function incMap(map, plan, amount = 1) {
  const key = String(plan || 'unknown').toLowerCase();
  map[key] = Number(map[key] || 0) + amount;
}

export function recordEmailAttempt(plan) {
  incMap(metrics.emails_attempted_by_plan, plan);
}

export function recordEmailSent(plan) {
  incMap(metrics.emails_sent_by_plan, plan);
  if (String(plan || '').toLowerCase() === 'free') metrics.free_email_digest_sent += 1;
}

export function recordEmailSkipped(reason) {
  if (reason === 'no_value') metrics.emails_skipped_no_value += 1;
  else if (reason === 'preferences') metrics.emails_skipped_preferences += 1;
  else if (reason === 'not_ready') metrics.emails_skipped_not_ready += 1;
}

export function recordEmailDeliveryFailed() {
  metrics.email_delivery_failed += 1;
}

export function getEmailMetrics() {
  return JSON.parse(JSON.stringify(metrics));
}

export function resetEmailMetrics() {
  metrics = initial();
}
