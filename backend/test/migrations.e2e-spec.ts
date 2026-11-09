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
    expect(names).toEqual(['001_foundation', '002_core_finance', '003_reservations', '004_budgets_goals', '005_reservation_lifecycle', '006_goal_allocation', '007_account_tracking', '008_idempotency']);
    const roles = await db.selectFrom('roles').select('key').execute();
    expect(roles.map((r) => r.key).sort()).toEqual(['org_admin', 'standard_user', 'super_admin']);
    const cats = await db.selectFrom('transaction_categories').select('id').where('owner_id', 'is', null).execute();
    expect(cats).toHaveLength(24);
  });

  it('is safe when several instances migrate a fresh database at the same time (zero-downtime deploys)', async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      // PGlite has a single connection, so only the call-level overlap can be exercised here.
      await Promise.all([migrate(db), migrate(db), migrate(db)]);
      return;
    }
    const fresh = `${schema}_c`;
    await sql.raw(`CREATE SCHEMA ${fresh}`).execute(db);
    const instances = [1, 2, 3].map(() => createDatabase({ databaseUrl: `${url}${url.includes('?') ? '&' : '?'}options=-c%20search_path%3D${fresh}` }));
    try {
      await Promise.all(instances.map((i) => migrate(i)));
      const names = await instances[0].selectFrom('_migrations').select('name').execute();
      expect(names).toHaveLength(8);
      const cats = await instances[0].selectFrom('transaction_categories').select('id').where('owner_id', 'is', null).execute();
      expect(cats).toHaveLength(24);
    } finally {
      await Promise.all(instances.map((i) => i.destroy()));
      await sql.raw(`DROP SCHEMA ${fresh} CASCADE`).execute(db);
    }
  });

  it('rolls back every migration added since the baseline and re-applies them', async () => {
    for (const name of ['008_idempotency', '007_account_tracking', '006_goal_allocation', '005_reservation_lifecycle', '004_budgets_goals']) {
      expect(await rollbackLast(db)).toBe(name);
    }
    await expect(sql`SELECT 1 FROM budgets`.execute(db)).rejects.toThrow();
    await expect(sql`SELECT tracking_start_date FROM bank_accounts`.execute(db)).rejects.toThrow();
    await migrate(db);
    await sql`SELECT 1 FROM idempotency_keys`.execute(db);
    await sql`SELECT occurrence_date FROM money_reservations`.execute(db);
  });

  it('upgrades data written under the pre-review schema (004 → 008)', async () => {
    for (let i = 0; i < 4; i++) await rollbackLast(db); // back to 004
    const org = (await sql<{ id: string }>`INSERT INTO organizations (name) VALUES ('legacy') RETURNING id`.execute(db)).rows[0].id;
    const user = (await sql<{ id: string }>`INSERT INTO users (email, full_name, default_organization_id) VALUES (${`legacy${Date.now()}@x.com`}, 'l', ${org}) RETURNING id`.execute(db)).rows[0].id;
    const acct = (await sql<{ id: string }>`INSERT INTO bank_accounts (owner_id, organization_id, name, type, opening_balance, opening_date, is_liquid, is_liability) VALUES (${user}, ${org}, 'a', 'savings', 100, '2026-03-01', true, false) RETURNING id`.execute(db)).rows[0].id;
    const txn = (await sql<{ id: string }>`INSERT INTO transactions (owner_id, organization_id, type, status, amount, account_id, occurred_at) VALUES (${user}, ${org}, 'expense', 'confirmed', 50, ${acct}, now()) RETURNING id`.execute(db)).rows[0].id;
    const res = (await sql<{ id: string }>`INSERT INTO money_reservations (owner_id, organization_id, account_id, name, target_amount, reserved_amount, due_date, status, transaction_id, settled_amount, variance, closed_at) VALUES (${user}, ${org}, ${acct}, 'r', 50, 50, '2026-11-01', 'reconciled', ${txn}, 50, 0, now()) RETURNING id`.execute(db)).rows[0].id;
    const goal = (await sql<{ id: string }>`INSERT INTO financial_goals (owner_id, organization_id, name, target_amount) VALUES (${user}, ${org}, 'g', 1000) RETURNING id`.execute(db)).rows[0].id;

    await migrate(db);
    const a = await db.selectFrom('bank_accounts').select(['tracking_start_date', 'opening_date']).where('id', '=', acct).executeTakeFirstOrThrow();
    expect(a).toEqual({ tracking_start_date: '2026-03-01', opening_date: '2026-03-01' });
    const r = await db.selectFrom('money_reservations').select(['occurrence_date']).where('id', '=', res).executeTakeFirstOrThrow();
    expect(r.occurrence_date).toBe('2026-11-01');
    const s = await db.selectFrom('reservation_settlements').selectAll().where('reservation_id', '=', res).execute();
    expect(s).toEqual([expect.objectContaining({ transaction_id: txn, amount: '50.00', variance: '0.00', status: 'active' })]);
    const g = await db.selectFrom('financial_goals').select('allocation_mode').where('id', '=', goal).executeTakeFirstOrThrow();
    expect(g.allocation_mode).toBe('reserve'); // existing goals keep their previous behaviour
    const t2 = await db.selectFrom('transactions').select('is_historical').where('id', '=', txn).executeTakeFirstOrThrow();
    expect(t2.is_historical).toBe(false);
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
      .values({ owner_id: user.id, organization_id: org.id, name: 'a', type: 'savings', institution_name: null, account_mask: null, opening_balance: '0', opening_date: null, tracking_start_date: '2026-01-01', is_liquid: true, is_liability: false, credit_limit: null, archived_at: null, deleted_at: null })
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
      db.insertInto('money_reservations').values({ owner_id: user.id, organization_id: org.id, commitment_id: null, account_id: acct.id, name: 'r', target_amount: '100', reserved_amount: '150', due_date: '2026-12-01', occurrence_date: '2026-12-01', created_from_reservation_id: null, close_reason: null, transaction_id: null, settled_amount: null, variance: null, closed_at: null }).execute(),
    ).rejects.toThrow(); // cannot reserve more than the target
    await expect(sql`INSERT INTO ledger_entries (owner_id, transaction_id, account_id, amount) SELECT ${user.id}, id, ${acct.id}, 0 FROM transactions LIMIT 1`.execute(db)).rejects.toThrow();
    // Exact decimals: 0.1 + 0.2 = 0.3 in NUMERIC.
    const r = await sql<{ v: string }>`SELECT (0.10::numeric(19,2) + 0.20::numeric(19,2))::text AS v`.execute(db);
    expect(r.rows[0].v).toBe('0.30');
  });
});
