# Test Report

Only runs that were actually executed are recorded here.

## Latest run — 2026-11-08 (branch `feature/budget-management`)

| Environment | Command | Result |
|---|---|---|
| PGlite (in-memory), Node 20.14, Windows 10 | `npm test` | **70 / 70 passed** |
| Real PostgreSQL **17.11** (local, via `embedded-postgres`), Node 20.14, Windows 10 | `TEST_DATABASE_URL=postgres://…:54329/pfm_test npm test` | **70 / 70 passed**, 3 consecutive runs |
| Real PostgreSQL 17.11 | `npm run migrate` → `npm run migrate -- --down` → `npm run migrate` | All 4 migrations applied; 004 rolled back and re-applied |
| GitHub Actions, PostgreSQL 16 | `.github/workflows/ci.yml` | **Not run yet** — the repository has no remote. First push will run it. |

Real-PostgreSQL compatibility is therefore validated on **PostgreSQL 17.11 locally**. The CI job on PostgreSQL 16 still has to pass before PG 16 compatibility is claimed.

## Suites

| Suite | Tests | Covers |
|---|---|---|
| `test/finance.e2e-spec.ts` | 17 | Critical cases 1–10, partial reservations, overcommitment, validation, expense insight, account archive/reconcile |
| `test/auth-rbac.e2e-spec.ts` | 11 | Registration, login, token rotation + reuse, logout, email verification, password reset, hashing at rest, case 12 isolation, admin-without-finance-access, permission enforcement |
| `test/budgets-goals.e2e-spec.ts` | 20 | Budgets (alerts once per period, transfers/card payments excluded, failed/duplicate/edit/delete, **case 11 reset on the 1st and on day 15, India time**, rollover, weekly/custom, duplicates, privacy); goals (allocations not income/expense, withdrawals, auto-complete, archive release, FD goals, privacy); forecast (full worked example, new user); concurrency; failure rollback |
| `test/migrations.e2e-spec.ts` | 3 | Idempotent migrations + seed, rollback/re-apply, DB-level constraints (positive amounts, transfer shape, FK, unique bank reference, reservation ≤ target, non-zero ledger entries, exact decimals) |
| `src/budgets/budget-period.spec.ts` | 8 | Period boundaries, reset day clamping, rollover arithmetic, daily target |
| `src/goals/goals.spec.ts` | 4 | Month counting, recommended monthly, completion estimates |
| `src/common/dates.spec.ts` | 3 | Date arithmetic, IST "today" |
| `src/transactions/ledger.service.spec.ts` | 4 | Ledger entry rules |

## Critical financial scenarios

| # | Scenario | Test |
|---|---|---|
| 1 | Income increases the correct balance | finance › 1 |
| 2 | Expense decreases the correct balance | finance › 2 |
| 3 | Transfers are not income/expense | finance › 3; budgets › transfers… never consume a budget |
| 4 | Reservations reduce available-to-spend | finance › 4 |
| 5 | Paying a reserved bill is not deducted twice | finance › 5, 5b, 5c; concurrency › settled once |
| 6 | Duplicates are not counted twice | finance › 6; concurrency › same reference concurrently |
| 7 | Credit card purchase/repayment | finance › 7 |
| 8 | Edits create correct reversals | finance › 8 |
| 9 | Failed transactions are not expenses | finance › 9; budgets › failed… |
| 10 | Multiple sources reconcile | finance › 10 |
| 11 | Monthly budget reset | budget-period › 11 (×2); budgets › 11, 11b |
| 12 | No access to other users' records | auth-rbac › 12; budgets/goals privacy tests |

## Concurrency note
On PGlite all connections are serialised, so the concurrency tests there check the logic but not real locking. On real PostgreSQL 17.11 they ran through a 10-connection pool and passed: concurrent duplicate references (unique index + retry), double settlement (`FOR UPDATE` on the reservation), and concurrent goal withdrawals (`FOR UPDATE` on the goal).

## Not yet tested
Flutter, web, email delivery, push notifications, Google Sign-In with real tokens, load/performance, backup/restore.
