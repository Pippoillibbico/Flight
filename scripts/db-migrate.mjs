import { initSqlDb } from '../server/lib/sql-db.js';

async function run() {
  await initSqlDb();
  console.log('db-migrate: OK');
}

run().catch((error) => {
  console.error('db-migrate: FAILED', error?.message || error);
  process.exit(1);
});
