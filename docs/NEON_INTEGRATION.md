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
| Full suite on Neon, after fix | PENDING (the result goes here when the run finishes) |

### Bug found by Neon: deadlock (fixed in `9d88ed4`)
- Reversing a paid occurrence locked *reservation → commitment → successor reservation*.
- Paying that successor at the same time locked *successor reservation → commitment*.
- With real network latency the two requests overlapped and PostgreSQL aborted one with a deadlock, which reached
  the user as a 500.
- **Fix:** `reservations.service.ts › reverseSettlementFor` now locks the successor reservation before the
  commitment, so every path follows *transaction → reservation(s) → commitment*.
- Local Postgres (low latency) had never shown this.

## 8. Next steps
1. In Render, set `DATABASE_URL` to the **pooled** string from `.env.local` (copy it from the Neon console; don't
   paste it into chat).
2. Neon runs PostgreSQL 18 while CI tests on 16. Consider adding 18 to the CI matrix.
