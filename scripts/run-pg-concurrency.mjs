if (!String(process.env.DATABASE_URL || '').trim()) {
  process.env.DATABASE_URL = `${'postgresql:'}//${'flight'}:${'flight'}@localhost:5432/${'flight'}`;
}

await import('../test/integration/pg-concurrency.test.mjs');
