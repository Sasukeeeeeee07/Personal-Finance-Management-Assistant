import { loadConfig } from '../config/env';
import { createDatabase } from './connection';
import { migrate, rollbackLast } from './migrator';

// Usage: npm run migrate            apply pending migrations
//        npm run migrate -- --down  roll back the latest migration
async function main() {
  const db = createDatabase(loadConfig());
  try {
    if (process.argv.includes('--down')) {
      const name = await rollbackLast(db, console.log);
      console.log(name ? 'Rollback complete.' : 'Nothing to roll back.');
    } else {
      await migrate(db, console.log);
      console.log('Migrations complete.');
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
