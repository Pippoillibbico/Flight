# Backup Strategy (Postgres + Audit Log)

## Scope
- Postgres primary data.
- Immutable audit log file: `data/audit-log.ndjson`.

## RPO/RTO targets
- Suggested RPO: 24h (daily full backup) or 1h (if WAL archiving is enabled).
- Suggested RTO: < 60 minutes for full restore in staging.

## Daily backup procedure
1. Set `DATABASE_URL` for the target database.
2. Run:
   - `npm run backup:postgres`
3. Output files are created in `backups/` by default:
   - `postgres-YYYYMMDD-HHMM.dump`
   - `audit-log-YYYYMMDD-HHMM.ndjson`

## Retention
- Keep 7 daily + 4 weekly + 6 monthly backups.
- Encrypt and replicate backups to offsite storage.

## Restore drill (recommended weekly in staging)
1. Restore DB:
   - `pg_restore --clean --if-exists --dbname "<target_db_url>" backups/postgres-*.dump`
2. Restore audit file:
   - replace `data/audit-log.ndjson` with chosen backup.
3. Verify:
   - `GET /api/health`
   - `GET /api/security/audit/verify` returns `ok: true`.

## Notes
- The backup script requires `pg_dump` available in PATH.
- For stricter RPO, enable Postgres WAL archiving on top of daily dumps.

