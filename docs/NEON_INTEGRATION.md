# Neon integration report — 2026-11-09

Target: Neon project (region **ap-southeast-1, Singapore**), branch `main`, database `neondb`.
Credentials stay in the git-ignored root `.env.local` (written by the Neon CLI). None are printed here or committed.
`neon deploy` was **not** run. Nothing was dropped or overwritten in `public`.

## 1. Backend database configuration (inspected)
- `backend/src/database/connection.ts`:
  - `DATABASE_URL` set → node-postgres pool (max 10, connect timeout 15 s for Neon wake-up, idle 30 s);
  - unset → embedded PGlite (development only).
- The backend reads **real environment variables only** (no dotenv). Locally the Neon values were loaded from
  `.env.local` by a script. On Render, set `DATABASE_URL` in the dashboard.
- Migrations: static ordered list `001`–`008` in `backend/src/database/migrator.ts`. They run on app start or via
  `node dist/database/migrate.cli.js`, each in its own transaction, recorded in `_migrations`, and serialized with
  `pg_advisory_xact_lock`.

## 2. Connection variables
| Variable | Host type | Params | Use |
|---|---|---|---|
| `DATABASE_URL` | pooled (`-pooler`) | `sslmode=require&channel_binding=require` | the app (Render `DATABASE_URL`) |
| `DATABASE_URL_UNPOOLED` | direct | same | `pg_dump` / admin / test schema |

User, password and database name are present in both. Both connect.

## 3. SSL
| Connection | Connect time | Client TLS | Certificate verified |
|---|---|---|---|
| pooled | 2.1 s (cold) | TLSv1.3 | yes |
| direct | 0.9 s | TLSv1.3 | yes |

- Server-side `pg_stat_ssl` shows `false`. That's expected, because Neon's proxy terminates TLS.
- pg 8.x warns that `sslmode=require` is treated as `verify-full`. That's the stricter behavior and works with
  Neon's certificates, so no change is needed. To silence the warning, use `sslmode=verify-full` in the URL.

## 4. Database state before migrating
- Server: **PostgreSQL 18.6**, encoding UTF8, timezone GMT.
- Objects in user schemas: **none**. `public` enums/domains: 0. Extensions: `plpgsql` only.
- `_migrations`: absent, so the database was empty and safe to migrate.

## 5. Migrations applied (pooled URL, the app's own migrate CLI)
Applied in order `001_foundation, 002_core_finance, 003_reservations, 004_budgets_goals, 005_reservation_lifecycle,
006_goal_allocation, 007_account_tracking, 008_idempotency`, ending in "Migrations complete."

Verification afterwards:
- `_migrations` has all 8 rows;
- 22 tables in `public`;
- reference data: 3 roles, 9 permissions, 24 system categories;
- **0 users and 0 transactions** (no fake data).

A second run applied nothing ("Migrations complete."), so migrations are idempotent.

Note: the CLI refuses to start with `NODE_ENV=production` unless the full production config (JWT secret, CORS, app
URL) is present. Run it without `NODE_ENV`, or let the app migrate on its first start on Render.

## 6. Backend connected to Neon
`node dist/main.js` with the pooled `DATABASE_URL`:
- database module ready in about 4.3 s;
- `GET /api/v1/health/ready` returns **200 `{"status":"ok","database":"ok"}`**;
- `GET /api/v1/categories` without a token returns **401**.

## 7. Backend tests
Run against Neon in a throwaway schema (`pfm_test_<timestamp>`, created and then dropped), so the real `public`
schema never received test data. `public` was re-verified afterwards: still 0 users and 0 transactions.

| Run | Result |
|---|---|
| Full suite on Neon, before fix | **123 / 124 passed**. Failed: `review-gate` › B1 › *concurrent reversal and successor payment leave a consistent state* (DELETE returned **500**) |
| That test alone on Neon, before fix | failed 3 / 3 runs |
| Concurrency tests on Neon, after fix | **passed 3 / 3 runs** (2 tests each) |
| Full suite on PGlite, after fix | **124 / 124 passed** |
| Full suite on PGlite, after both fixes (`0ef58b2`) | **125 / 125 passed** |
| Full suite on Neon, after both fixes (`0ef58b2`) | **125 / 125 passed, 0 failed** (14 suites, ~17 min; throwaway schema dropped; `public` re-verified: 8 migrations, 0 users, 0 transactions) |

### Bug found by Neon: deadlock (fixed in `9d88ed4`)
- Reversing a paid occurrence locked *reservation → commitment → successor reservation*.
- Paying that successor at the same time locked *successor reservation → commitment*.
- With real network latency the two requests overlapped and PostgreSQL aborted one with a deadlock, which reached
  the user as a 500.
- **Fix:** `reservations.service.ts › reverseSettlementFor` now locks the successor reservation before the
  commitment, so every path follows *transaction → reservation(s) → commitment*.
- Local Postgres (low latency) had never shown this.

### Deadlock review (both fixes)

**Lock order.** Every path that touches reservations and commitments now takes row locks in the same order:
*transaction → account (ledger) → reservation(s) → commitment*. Paths reviewed in `reservations.service.ts` and
`transactions.service.ts`:

| Path | Locks, in order |
|---|---|
| Mark paid (`POST /transactions` with `reservationId`) | new transaction → account → reservation (`findActive`) → commitment (`scheduleSuccessor`) |
| Settle with an existing payment | transaction → reservation → commitment |
| Delete / unconfirm / retype a payment | transaction → account → settlement → paid reservation → **successor reservation → commitment** (fixed in `9d88ed4`; it was commitment → successor) |
| Release a reservation | reservation → commitment |
| Adjust a reservation | reservation only |
| Cancel a commitment | **open reservations (id order) → commitment** (fixed in `0ef58b2`; it was commitment → reservations, a second deadlock found during this review) |

**Rollback.** Each operation runs in a single `db.transaction()`. Any error inside it, including a deadlock abort,
rolls back everything: ledger entries, settlement rows, reservation changes and audit rows. Covered by:
- "a failure during reversal rolls back the deletion entirely" (forced failure mid-reversal; balances unchanged);
- the new cancel test (when cancel wins, the payment returns 409 and **no** expense or ledger entry remains).

**Isolation and atomicity.** Unchanged. The default READ COMMITTED applies. Every read that decides a write uses
`SELECT … FOR UPDATE`, which re-reads the latest committed row after waiting, so the successor's status is checked
after it is locked. The fixes only reorder locks; no logic or isolation level changed. The database constraint
"one live reservation per occurrence" is still enforced, with its own test.

**Regression tests** (`backend/test/review-gate.e2e-spec.ts`, B1). These need real PostgreSQL; PGlite has a single
connection.
- *concurrent reversal and successor payment leave a consistent state* (cancelling a bill payment while paying the next one): failed 3/3 on Neon before `9d88ed4`, passes 3/3 after.
- *concurrent "mark paid" and "cancel commitment" never deadlock…* (new): **failed 3/3 on Neon with the fix temporarily removed (500), passes 3/3 with it.**
- *concurrent deletes of the same payment reverse it once*: passes.

## 8. CI: PostgreSQL 16 and 18
`.github/workflows/ci.yml`, job `postgresql`, now a matrix `['16', '18']` (`fail-fast: false`).

Each leg runs:
1. `postgres:<version>` initialized with `--encoding=UTF8 --locale=C.UTF-8`;
2. asserts the server major version and `server_encoding = UTF8`;
3. confirms the database starts empty;
4. `npm run migrate`, then verifies every migration is recorded;
5. rolls back the latest migration and re-applies it;
6. runs the full suite with `TEST_DATABASE_URL` (real PostgreSQL).

Result: **NOT VERIFIED.** The matrix is committed locally (`0ef58b2`) but not pushed, so GitHub hasn't run it yet.
The workflow YAML was parsed locally and is valid.

## 9. Next steps
1. In Render, set `DATABASE_URL` to the **pooled** string from `.env.local` (copy it from the Neon console; don't
   paste it into chat).
2. Push, then confirm both CI legs (PostgreSQL 16 and 18) pass before merging.
