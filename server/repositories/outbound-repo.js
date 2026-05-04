export class OutboundRepo {
  constructor(db) {
    this.db = db || null;
  }

  isAvailable() {
    return Boolean(this.db && typeof this.db.query === 'function');
  }

  assertAvailable() {
    if (this.isAvailable()) return;
    throw new Error('Outbound repository requires a Postgres client/pool');
  }

  async insertClick(click) {
    this.assertAvailable();
    const destinationUrl = this.sanitizeDestinationUrl(click?.destinationUrl);
    if (!destinationUrl) {
      throw new Error('Outbound destination URL is required');
    }
    await this.db.query(
      `INSERT INTO outbound_clicks
        (user_id, provider, itinerary_id, destination_url, correlation_id, redirect_status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        click?.userId || null,
        click?.provider || null,
        click?.itineraryId || null,
        destinationUrl,
        click?.correlationId || null,
        click?.redirectStatus || 'pending'
      ]
    );
  }

  sanitizeDestinationUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    try {
      const parsed = new URL(value);
      return `${parsed.origin}${parsed.pathname}`.slice(0, 1200);
    } catch {
      return value.split('?')[0].split('#')[0].slice(0, 1200);
    }
  }

  async markRedirectSucceeded(correlationId) {
    this.assertAvailable();
    const correlation = String(correlationId || '').trim();
    if (!correlation) return;
    await this.db.query(
      `UPDATE outbound_clicks
       SET redirect_status = 'succeeded', failure_reason = NULL, updated_at = NOW()
       WHERE correlation_id = $1`,
      [correlation]
    );
  }

  async markRedirectFailed(correlationId, reason) {
    this.assertAvailable();
    const correlation = String(correlationId || '').trim();
    if (!correlation) return;
    await this.db.query(
      `UPDATE outbound_clicks
       SET redirect_status = 'failed', failure_reason = $2, updated_at = NOW()
       WHERE correlation_id = $1`,
      [correlation, String(reason || 'unknown_failure').trim().slice(0, 120)]
    );
  }
}
