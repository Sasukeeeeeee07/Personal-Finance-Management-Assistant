import { loadConfig } from '../config/env';
import { createDatabase } from './connection';
import { migrate } from './migrator';

async function main() {
  const db = createDatabase(loadConfig());
  try {
    await migrate(db, console.log);
    console.log('Migrations complete.');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
