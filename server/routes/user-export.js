/**
 * User data export — GET /api/user/data-export and /api/user/data-export.csv
 *
 * Allows authenticated users to download their own data:
 * search history, price alerts, watchlist, notifications.
 *
 * Uses the `export` quota counter (Creator plan: 400/month).
 * Free and Pro plans with export quota 0 receive 403 upgrade_required.
 */
import { Router } from 'express';
import { format } from 'date-fns';

export function buildUserExportRouter({ authGuard, requireSessionAuth, quotaGuard, withDb, readDb }) {
  const router = Router();

  /**
   * Build the user's exportable data snapshot.
   * Returns a plain JS object — ready for JSON or CSV serialisation.
   */
  async function buildUserExportSnapshot(userId) {
    const db = await readDb();

    const searches = (db.searches || [])
      .filter((s) => s.userId === userId)
      .map((s) => ({
        id: s.id,
        at: s.at,
        origin: s.payload?.origin || '',
        destination: s.payload?.destination || '',
        date_from: s.payload?.dateFrom || '',
        date_to: s.payload?.dateTo || '',
        cabin_class: s.payload?.cabinClass || ''
      }));

    const priceAlerts = (db.priceAlerts || [])
      .filter((a) => a.userId === userId && !a.deletedAt)
      .map((a) => ({
        id: a.id,
        origin: a.origin || '',
        destination: a.destinationIata || '',
        target_price: a.targetPrice ?? '',
        created_at: a.createdAt || '',
        enabled: Boolean(a.enabled)
      }));

    const watchlist = (db.watchlists || [])
      .filter((w) => w.userId === userId)
      .map((w) => ({
        id: w.id,
        origin: w.origin || '',
        destination: w.destination || '',
        created_at: w.createdAt || ''
      }));

    const notifications = (db.notifications || [])
      .filter((n) => n.userId === userId)
      .slice(-200)
      .map((n) => ({
        id: n.id,
        type: n.type || '',
        message: n.message || '',
        read: Boolean(n.readAt),
        created_at: n.createdAt || ''
      }));

    return {
      exported_at: new Date().toISOString(),
      user_id: userId,
      search_history: searches,
      price_alerts: priceAlerts,
      watchlist,
      notifications
    };
  }

  /**
   * Serialize a snapshot to CSV (one section per data type,
   * separated by blank lines).
   */
  function snapshotToCsv(snapshot) {
    function rowsToCsv(headers, rows) {
      const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const head = headers.join(',');
      const body = rows.map((r) => headers.map((h) => escape(r[h])).join(',')).join('\n');
      return `${head}\n${body}`;
    }

    const sections = [];

    sections.push(`# exported_at: ${snapshot.exported_at}`);
    sections.push(`# user_id: ${snapshot.user_id}`);
    sections.push('');

    sections.push('## search_history');
    sections.push(
      rowsToCsv(['id', 'at', 'origin', 'destination', 'date_from', 'date_to', 'cabin_class'], snapshot.search_history)
    );
    sections.push('');

    sections.push('## price_alerts');
    sections.push(
      rowsToCsv(['id', 'origin', 'destination', 'target_price', 'created_at', 'enabled'], snapshot.price_alerts)
    );
    sections.push('');

    sections.push('## watchlist');
    sections.push(rowsToCsv(['id', 'origin', 'destination', 'created_at'], snapshot.watchlist));
    sections.push('');

    sections.push('## notifications');
    sections.push(rowsToCsv(['id', 'type', 'message', 'read', 'created_at'], snapshot.notifications));

    return sections.join('\n');
  }

  // JSON export — no API key required, session auth + export quota
  router.get(
    '/user/data-export',
    authGuard,
    requireSessionAuth,
    quotaGuard({ counter: 'export', amount: 1 }),
    async (req, res) => {
      const snapshot = await buildUserExportSnapshot(req.user.sub);
      return res.json(snapshot);
    }
  );

  // CSV export — same guards
  router.get(
    '/user/data-export.csv',
    authGuard,
    requireSessionAuth,
    quotaGuard({ counter: 'export', amount: 1 }),
    async (req, res) => {
      const snapshot = await buildUserExportSnapshot(req.user.sub);
      const csv = snapshotToCsv(snapshot);
      const filename = `flight-suite-export-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csv);
    }
  );

  return router;
}
