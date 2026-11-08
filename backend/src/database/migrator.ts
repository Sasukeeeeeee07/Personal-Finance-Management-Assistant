import { sql } from 'kysely';
import type { DB } from './schema';
import * as m001 from './migrations/001_foundation';
import * as m002 from './migrations/002_core_finance';
import * as m003 from './migrations/003_reservations';
import * as m004 from './migrations/004_budgets_goals';
import * as m005 from './migrations/005_reservation_lifecycle';
import * as m006 from './migrations/006_goal_allocation';
import * as m007 from './migrations/007_account_tracking';
import * as m008 from './migrations/008_idempotency';
import { PERMISSION_DESCRIPTIONS, ROLE_DEFINITIONS } from '../rbac/permissions';

const MIGRATIONS: { name: string; up: string; down?: string }[] = [m001, m002, m003, m004, m005, m006, m007, m008];

// Prepared statements accept one command each; migrations contain no semicolons inside bodies.
const statements = (script: string) => script.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);

export const SYSTEM_CATEGORIES: { name: string; kind: 'income' | 'expense'; essential: boolean }[] = [
  { name: 'Salary', kind: 'income', essential: false },
  { name: 'Freelance', kind: 'income', essential: false },
  { name: 'Business', kind: 'income', essential: false },
  { name: 'Bonus', kind: 'income', essential: false },
  { name: 'Interest', kind: 'income', essential: false },
  { name: 'Gifts', kind: 'income', essential: false },
  { name: 'Other income', kind: 'income', essential: false },
  { name: 'Food', kind: 'expense', essential: false },
  { name: 'Groceries', kind: 'expense', essential: true },
  { name: 'Travel', kind: 'expense', essential: false },
  { name: 'Transportation', kind: 'expense', essential: true },
  { name: 'Rent', kind: 'expense', essential: true },
  { name: 'Electricity', kind: 'expense', essential: true },
  { name: 'Internet', kind: 'expense', essential: true },
  { name: 'Mobile recharge', kind: 'expense', essential: true },
  { name: 'Shopping', kind: 'expense', essential: false },
  { name: 'Entertainment', kind: 'expense', essential: false },
  { name: 'Healthcare', kind: 'expense', essential: true },
  { name: 'Education', kind: 'expense', essential: true },
  { name: 'Subscriptions', kind: 'expense', essential: false },
  { name: 'EMI', kind: 'expense', essential: true },
  { name: 'Investments', kind: 'expense', essential: false },
  { name: 'Personal', kind: 'expense', essential: false },
  { name: 'Miscellaneous', kind: 'expense', essential: false },
];

export async function migrate(db: DB, log: (msg: string) => void = () => {}): Promise<void> {
  // Names, notes and merchants are user text (₹, Hindi, emoji); a non-UTF-8 database would corrupt or reject them.
  const enc = await sql<{ server_encoding: string }>`SHOW server_encoding`.execute(db);
  if (enc.rows[0]?.server_encoding?.toUpperCase() !== 'UTF8') {
    throw new Error(`Database encoding is ${enc.rows[0]?.server_encoding}; UTF8 is required. Create the database with ENCODING 'UTF8'.`);
  }
  await sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`.execute(db);
  const applied = new Set((await db.selectFrom('_migrations').select('name').execute()).map((r) => r.name));
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    await db.transaction().execute(async (trx) => {
      for (const statement of statements(m.up)) await sql.raw(statement).execute(trx);
      await trx.insertInto('_migrations').values({ name: m.name }).execute();
    });
    log(`Applied migration ${m.name}`);
  }
  await seedReferenceData(db);
}

/** Roll back the most recently applied migration. Destroys the data in the tables it created. */
export async function rollbackLast(db: DB, log: (msg: string) => void = () => {}): Promise<string | null> {
  const last = await db.selectFrom('_migrations').select('name').orderBy('name', 'desc').limit(1).executeTakeFirst();
  if (!last) return null;
  const m = MIGRATIONS.find((x) => x.name === last.name);
  if (!m?.down) throw new Error(`Migration ${last.name} has no down script`);
  await db.transaction().execute(async (trx) => {
    for (const statement of statements(m.down!)) await sql.raw(statement).execute(trx);
    await trx.deleteFrom('_migrations').where('name', '=', m.name).execute();
  });
  log(`Rolled back migration ${m.name}`);
  return m.name;
}

/** Idempotent seed of roles, permissions and system categories. Contains no user data. */
export async function seedReferenceData(db: DB): Promise<void> {
  await db.transaction().execute(async (trx) => {
    for (const [key, description] of Object.entries(PERMISSION_DESCRIPTIONS)) {
      await trx
        .insertInto('permissions')
        .values({ key, description })
        .onConflict((oc) => oc.column('key').doUpdateSet({ description }))
        .execute();
    }
    for (const role of ROLE_DEFINITIONS) {
      const { id: roleId } = await trx
        .insertInto('roles')
        .values({ key: role.key, name: role.name, scope: role.scope })
        .onConflict((oc) => oc.column('key').doUpdateSet({ name: role.name }))
        .returning('id')
        .executeTakeFirstOrThrow();
      const perms = await trx.selectFrom('permissions').select('id').where('key', 'in', role.permissions).execute();
      for (const p of perms) {
        await trx
          .insertInto('role_permissions')
          .values({ role_id: roleId, permission_id: p.id })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
    }
    const existing = await trx.selectFrom('transaction_categories').select(['name', 'kind']).where('owner_id', 'is', null).execute();
    const have = new Set(existing.map((c) => `${c.kind}:${c.name.toLowerCase()}`));
    const missing = SYSTEM_CATEGORIES.filter((c) => !have.has(`${c.kind}:${c.name.toLowerCase()}`));
    if (missing.length) {
      await trx
        .insertInto('transaction_categories')
        .values(missing.map((c) => ({ owner_id: null, name: c.name, kind: c.kind, is_essential: c.essential, icon: null })))
        .execute();
    }
  });
}
