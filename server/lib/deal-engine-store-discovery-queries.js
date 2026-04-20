const CREATE_DISCOVERY_SUBSCRIPTION_POSTGRES_SQL = `
  INSERT INTO discovery_alert_subscriptions
     (id, user_id, origin_iata, budget_eur, mood, region, date_from, date_to, enabled, created_at, updated_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
   RETURNING *
`;

const CREATE_DISCOVERY_SUBSCRIPTION_SQLITE_SQL = `
  INSERT INTO discovery_alert_subscriptions
     (id, user_id, origin_iata, budget_eur, mood, region, date_from, date_to, enabled, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`;

const LIST_DISCOVERY_SUBSCRIPTIONS_POSTGRES_SQL = `
  SELECT * FROM discovery_alert_subscriptions WHERE user_id = $1 ORDER BY created_at DESC
`;

const LIST_DISCOVERY_SUBSCRIPTIONS_SQLITE_SQL = `
  SELECT * FROM discovery_alert_subscriptions WHERE user_id = ? ORDER BY created_at DESC
`;

const DELETE_DISCOVERY_SUBSCRIPTION_POSTGRES_SQL = `
  DELETE FROM discovery_alert_subscriptions WHERE id = $1 AND user_id = $2 RETURNING id
`;

const DELETE_DISCOVERY_SUBSCRIPTION_SQLITE_SQL = `
  DELETE FROM discovery_alert_subscriptions WHERE id = ? AND user_id = ?
`;

const LIST_ACTIVE_DISCOVERY_SUBSCRIPTIONS_POSTGRES_SQL = `
  SELECT * FROM discovery_alert_subscriptions WHERE enabled = true
`;

const LIST_ACTIVE_DISCOVERY_SUBSCRIPTIONS_SQLITE_SQL = `
  SELECT * FROM discovery_alert_subscriptions WHERE enabled = 1
`;

const GET_DISCOVERY_WORKER_CURSOR_POSTGRES_SQL = `
  SELECT last_observed_at FROM discovery_worker_state WHERE id = 1
`;

const GET_DISCOVERY_WORKER_CURSOR_SQLITE_SQL = `
  SELECT last_observed_at FROM discovery_worker_state WHERE id = 1
`;

const SET_DISCOVERY_WORKER_CURSOR_POSTGRES_SQL = `
  INSERT INTO discovery_worker_state (id, last_observed_at, updated_at)
   VALUES (1, $1, NOW())
   ON CONFLICT (id) DO UPDATE SET last_observed_at = EXCLUDED.last_observed_at, updated_at = NOW()
`;

const SET_DISCOVERY_WORKER_CURSOR_SQLITE_SQL = `
  INSERT INTO discovery_worker_state (id, last_observed_at, updated_at)
   VALUES (1, ?, datetime('now'))
   ON CONFLICT(id) DO UPDATE SET last_observed_at=excluded.last_observed_at, updated_at=datetime('now')
`;

const CLAIM_DISCOVERY_DEDUPE_POSTGRES_SQL = `
  INSERT INTO discovery_notification_dedupe
     (dedupe_key, user_id, subscription_id, observation_fingerprint, created_at)
   VALUES ($1,$2,$3,$4,NOW())
   ON CONFLICT (dedupe_key) DO NOTHING
   RETURNING dedupe_key
`;

const CLAIM_DISCOVERY_DEDUPE_SQLITE_SQL = `
  INSERT OR IGNORE INTO discovery_notification_dedupe
     (dedupe_key, user_id, subscription_id, observation_fingerprint, created_at)
   VALUES (?, ?, ?, ?, datetime('now'))
   RETURNING dedupe_key
`;

export {
  CLAIM_DISCOVERY_DEDUPE_POSTGRES_SQL,
  CLAIM_DISCOVERY_DEDUPE_SQLITE_SQL,
  CREATE_DISCOVERY_SUBSCRIPTION_POSTGRES_SQL,
  CREATE_DISCOVERY_SUBSCRIPTION_SQLITE_SQL,
  DELETE_DISCOVERY_SUBSCRIPTION_POSTGRES_SQL,
  DELETE_DISCOVERY_SUBSCRIPTION_SQLITE_SQL,
  GET_DISCOVERY_WORKER_CURSOR_POSTGRES_SQL,
  GET_DISCOVERY_WORKER_CURSOR_SQLITE_SQL,
  LIST_ACTIVE_DISCOVERY_SUBSCRIPTIONS_POSTGRES_SQL,
  LIST_ACTIVE_DISCOVERY_SUBSCRIPTIONS_SQLITE_SQL,
  LIST_DISCOVERY_SUBSCRIPTIONS_POSTGRES_SQL,
  LIST_DISCOVERY_SUBSCRIPTIONS_SQLITE_SQL,
  SET_DISCOVERY_WORKER_CURSOR_POSTGRES_SQL,
  SET_DISCOVERY_WORKER_CURSOR_SQLITE_SQL
};
