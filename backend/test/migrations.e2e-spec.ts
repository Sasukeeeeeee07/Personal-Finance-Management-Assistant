import { sql } from 'kysely';
import { createDatabase } from '../src/database/connection';
import { migrate, rollbackLast } from '../src/database/migrator';
import type { DB } from '../src/database/schema';

/**
 * Runs against TEST_DATABASE_URL when set (real PostgreSQL), otherwise in-memory PGlite.
 * The real-Postgres run uses a throwaway schema so it never touches existing data.
 */
describe('Migrations and constraints', () => {
  let db: DB;
  const schema = `test_${Date.now()}`;

  beforeAll(async () => {
    db = createDatabase({ databaseUrl: process.env.TEST_DATABASE_URL });
    if (process.env.TEST_DATABASE_URL) {
      await sql.raw(`CREATE SCHEMA ${schema}`).execute(db);
      await db.destroy();
      db = createDatabase({ databaseUrl: `${process.env.TEST_DATABASE_URL}${process.env.TEST_DATABASE_URL.includes('?') ? '&' : '?'}options=-c%20search_path%3D${schema}` });
    }
    await migrate(db);
  });

  afterAll(async () => {
    if (process.env.TEST_DATABASE_URL) await sql.raw(`DROP SCHEMA ${schema} CASCADE`).execute(db);
    await db.destroy();
  });

  it('applies all migrations idempotently and seeds reference data', async () => {
    await migrate(db);
    const names = (await db.selectFrom('_migrations').select('name').orderBy('name').execute()).map((r) => r.name);
    expect(names).toEqual(['001_foundation', '002_core_finance', '003_reservations', '004_budgets_goals']);
    const roles = await db.selectFrom('roles').select('key').execute();
    expect(roles.map((r) => r.key).sort()).toEqual(['org_admin', 'standard_user', 'super_admin']);
    const cats = await db.selectFrom('transaction_categories').select('id').where('owner_id', 'is', null).execute();
    expect(cats).toHaveLength(24);
  });

  it('rolls back the latest migration and re-applies it', async () => {
    expect(await rollbackLast(db)).toBe('004_budgets_goals');
    await expect(sql`SELECT 1 FROM budgets`.execute(db)).rejects.toThrow();
    await migrate(db);
    await sql`SELECT 1 FROM budgets`.execute(db);
  });

  it('enforces financial constraints in the database itself', async () => {
    const org = await db.insertInto('organizations').values({ name: 'o', deleted_at: null }).returning('id').executeTakeFirstOrThrow();
    const user = await db
      .insertInto('users')
      .values({ email: `c${Date.now()}@x.com`, full_name: 'c', password_hash: null, google_sub: null, platform_role_id: null, default_organization_id: org.id, email_verified_at: null, deleted_at: null })
      .returning('id')
      .executeTakeFirstOrThrow();
    const acct = await db
      .insertInto('bank_accounts')
      .values({ owner_id: user.id, organization_id: org.id, name: 'a', type: 'savings', institution_name: null, account_mask: null, opening_balance: '0', is_liquid: true, is_liability: false, credit_limit: null, archived_at: null, deleted_at: null })
      .returning('id')
      .executeTakeFirstOrThrow();
    const txn = (over: object) =>
      db
        .insertInto('transactions')
        .values({ owner_id: user.id, organization_id: org.id, type: 'expense', status: 'confirmed', amount: '10', account_id: acct.id, destination_account_id: null, category_id: null, occurred_at: new Date(), merchant: null, source_name: null, description: null, notes: null, payment_method: null, external_reference: null, is_planned: null, is_essential: null, duplicate_of_id: null, deleted_at: null, ...over })
        .execute();

    await expect(txn({ amount: '0' })).rejects.toThrow(); // amount must be positive
    await expect(txn({ amount: '-5' })).rejects.toThrow();
    await expect(txn({ type: 'transfer' })).rejects.toThrow(); // transfer needs a destination
    await expect(txn({ destination_account_id: acct.id, type: 'transfer' })).rejects.toThrow(); // not to itself
    await expect(txn({ status: 'pending' })).rejects.toThrow();
    await expect(txn({ account_id: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(); // FK
    await txn({ external_reference: 'R1' });
    await expect(txn({ external_reference: 'R1' })).rejects.toThrow(); // same bank reference counted once
    await txn({ external_reference: 'R1', status: 'duplicate' }); // a stored duplicate is allowed
    await expect(
      db.insertInto('money_reservations').values({ owner_id: user.id, organization_id: org.id, commitment_id: null, account_id: acct.id, name: 'r', target_amount: '100', reserved_amount: '150', due_date: '2026-12-01', transaction_id: null, settled_amount: null, variance: null, closed_at: null }).execute(),
    ).rejects.toThrow(); // cannot reserve more than the target
    await expect(sql`INSERT INTO ledger_entries (owner_id, transaction_id, account_id, amount) SELECT ${user.id}, id, ${acct.id}, 0 FROM transactions LIMIT 1`.execute(db)).rejects.toThrow();
    // Exact decimals: 0.1 + 0.2 = 0.3 in NUMERIC.
    const r = await sql<{ v: string }>`SELECT (0.10::numeric(19,2) + 0.20::numeric(19,2))::text AS v`.execute(db);
    expect(r.rows[0].v).toBe('0.30');
  });
});
