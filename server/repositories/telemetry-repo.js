export class TelemetryRepo {
  constructor(db) {
    this.db = db || null;
  }

  isAvailable() {
    return Boolean(this.db && typeof this.db.query === 'function');
  }

  assertAvailable() {
    if (this.isAvailable()) return;
    throw new Error('Telemetry repository requires a Postgres client/pool');
  }

  async insertEvent(event) {
    this.assertAvailable();
    if (!event || !event.type) {
      throw new Error('Telemetry event type is required');
    }
    await this.db.query(
      `INSERT INTO telemetry_events (type, payload, user_id, correlation_id, created_at)
       VALUES ($1, $2::jsonb, $3, $4, $5::timestamptz)`,
      [
        String(event.type || '').trim(),
        JSON.stringify(event.payload || {}),
        event.userId || null,
        event.correlationId || null,
        event.createdAt || new Date().toISOString()
      ]
    );
  }

  async listRecentEvents(limit = 100) {
    this.assertAvailable();
    const safeLimit = Math.max(1, Math.min(20000, Number(limit) || 100));
    const result = await this.db.query(
      `SELECT id, type, payload, user_id, correlation_id, created_at
       FROM telemetry_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [safeLimit]
    );
    return result.rows || [];
  }

  async countRecentByFingerprint({ userId = null, fingerprint = '', eventAtIso, windowMs }) {
    this.assertAvailable();
    const normalizedFingerprint = String(fingerprint || '').trim();
    if (!normalizedFingerprint) return 0;
    const eventAt = new Date(eventAtIso || Date.now());
    const safeWindowMs = Math.max(1000, Number(windowMs) || 10000);
    const from = new Date(eventAt.getTime() - safeWindowMs).toISOString();
    const to = new Date(eventAt.getTime() + safeWindowMs).toISOString();
    const result = await this.db.query(
      `SELECT COUNT(*)::int AS count
       FROM telemetry_events
       WHERE user_id IS NOT DISTINCT FROM $1
         AND payload->>'fingerprint' = $2
         AND created_at >= $3::timestamptz
         AND created_at <= $4::timestamptz`,
      [userId || null, normalizedFingerprint, from, to]
    );
    return Number(result.rows?.[0]?.count || 0);
  }

  async hasDuplicateEvent(eventRecord, dedupeWindowMs) {
    this.assertAvailable();
    const eventAt = new Date(eventRecord?.at || Date.now());
    const safeWindowMs = Math.max(250, Number(dedupeWindowMs) || 2500);
    const from = new Date(eventAt.getTime() - safeWindowMs).toISOString();
    const to = new Date(eventAt.getTime() + safeWindowMs).toISOString();
    const result = await this.db.query(
      `SELECT 1
       FROM telemetry_events
       WHERE user_id IS NOT DISTINCT FROM $1
         AND (
           ($2 <> '' AND payload->>'eventId' = $2)
           OR ($3 <> '' AND payload->>'fingerprint' = $3)
           OR (
             type = $4
             AND COALESCE(payload->>'action', '') = $5
             AND COALESCE(payload->>'surface', '') = $6
             AND COALESCE(payload->>'source', '') = $7
             AND COALESCE(payload->>'planType', '') = $8
             AND COALESCE(payload->>'routeSlug', '') = $9
             AND COALESCE(payload->>'dealId', '') = $10
             AND COALESCE(payload->>'sessionId', '') = $11
             AND COALESCE(payload->>'price', '') = $12
             AND COALESCE(payload->>'correlationId', '') = $13
             AND COALESCE(payload->>'itineraryId', '') = $14
           )
         )
         AND created_at >= $15::timestamptz
         AND created_at <= $16::timestamptz
       LIMIT 1`,
      [
        eventRecord?.userId || null,
        String(eventRecord?.eventId || '').trim(),
        String(eventRecord?.fingerprint || '').trim(),
        String(eventRecord?.eventType || '').trim(),
        String(eventRecord?.action || ''),
        String(eventRecord?.surface || ''),
        String(eventRecord?.source || ''),
        String(eventRecord?.planType || ''),
        String(eventRecord?.routeSlug || ''),
        String(eventRecord?.dealId || ''),
        String(eventRecord?.sessionId || ''),
        eventRecord?.price == null ? '' : String(eventRecord.price),
        String(eventRecord?.correlationId || ''),
        String(eventRecord?.itineraryId || ''),
        from,
        to
      ]
    );
    return (result.rows || []).length > 0;
  }
}

