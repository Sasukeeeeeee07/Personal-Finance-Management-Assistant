import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import { PGlite, types as pgliteTypes } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database, DB } from './schema';

const PG_INT8_OID = 20;

/**
 * Production: DATABASE_URL (node-postgres pool).
 * Local dev / tests without Docker: embedded PGlite (real Postgres in WASM).
 * DATE columns are kept as 'YYYY-MM-DD' strings so no timezone shifting happens.
 */
export function createDatabase(opts: { databaseUrl?: string; pgliteDataDir?: string }): DB {
  if (opts.databaseUrl) {
    types.setTypeParser(1082, (v) => v);
    types.setTypeParser(PG_INT8_OID, (v) => v);
    // Serverless Postgres (Neon) may take a few seconds to wake from autosuspend.
    const pool = new Pool({ connectionString: opts.databaseUrl, max: 10, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 30_000 });
    return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  }
  const pglite = new PGlite({
    dataDir: opts.pgliteDataDir,
    parsers: {
      [pgliteTypes.DATE]: (v: string) => v,
      [pgliteTypes.INT8]: (v: string) => v,
    },
  });
  return new Kysely<Database>({ dialect: new PGliteDialect(pglite) });
}
