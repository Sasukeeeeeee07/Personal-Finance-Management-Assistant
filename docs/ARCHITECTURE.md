# Architecture

Canonical description of the system as implemented. If the code and this document disagree, the code is the source of truth and this document must be corrected.

## 1. Components

```
mobile/   Flutter (Android first, iOS compatible)       ─┐
web/      Next.js dashboard                              ├─ HTTPS / JSON ─► backend/ (NestJS, /api/v1)
                                                         ─┘                    │
                                                                               ├─ PostgreSQL (prod, CI) / PGlite (local dev)
                                                                               ├─ Redis + BullMQ (planned: email, push, schedules)
                                                                               ├─ SMTP (planned)  · Firebase Admin (planned)
                                                                               └─ Ollama (optional, planned)
```

The **backend is the only place financial numbers are calculated**. Clients display values the API returns and never recompute balances, budgets or forecasts.

## 2. Backend layout (`backend/src`)

| Module | Responsibility |
|---|---|
| `config/env.ts` | Typed config from environment. Production refuses to start without `DATABASE_URL` and a ≥32-char JWT secret. |
| `database/` | Kysely connection (pg pool or PGlite), typed schema (`schema.ts`), SQL migrations, migrator + reference seed. |
| `auth/` | Registration, login, Google ID token, email verification, password reset, sessions, global `AuthGuard`. |
| `rbac/` | Permission keys, role definitions, permission resolution. |
| `organizations/` | Membership administration (no access to members' finances). |
| `accounts/` | Financial accounts, balances, reconciliation against bank balance. |
| `categories/` | System + user categories. |
| `transactions/` | Income / expense / transfer, ledger posting, dedup, audit, expense insight. |
| `reservations/` | Commitments and Money Lock reservations, settlement. |
| `budgets/` | Budget periods, utilisation, rollover, threshold alerts. |
| `goals/` | Savings goals and contributions (allocations). |
| `forecast/` | Month-end balance forecast with explicit assumptions. |
| `dashboard/` | `FinancialSummaryService`: the single implementation of available-to-spend. |
| `audit/` | Audit log writer (always inside the same DB transaction as the change). |

Request flow: `ThrottlerGuard` → `AuthGuard` (JWT verify → session still active → load permissions → check `@RequirePermissions`) → `ValidationPipe` (whitelist, reject unknown fields) → controller → service → Kysely.

## 3. Data model

All money columns are `NUMERIC(19,2)`, read and written as strings, computed with `decimal.js`. Dates without time (`due_date`, budget periods) are `DATE` returned as `'YYYY-MM-DD'` strings.

Every financial table carries `owner_id` (the user) and `organization_id` (tenant). Every financial query filters on `owner_id = <authenticated user>`. A record owned by someone else is indistinguishable from a missing one (404).

### Ledger

```
transactions (1) ──< ledger_entries (n)
balance(account) = bank_accounts.opening_balance + Σ ledger_entries.amount
```

| Transaction | Ledger entries |
|---|---|
| income | +amount on account |
| expense | −amount on account (on a credit card: more owed) |
| transfer | −amount on source, +amount on destination |
| needs_review / duplicate / ignored / failed / deleted | none |

Entries are never updated or deleted. An edit posts reversing entries for the old effect and new entries for the new effect.

### Allocations (never in the ledger)

| Allocation | Table | Reduces available-to-spend while |
|---|---|---|
| Reservation | `money_reservations` | `status = 'active'` (by `reserved_amount`) |
| Goal savings | `goal_contributions` | goal not archived and its account is liquid or unset |

```
available_to_spend = liquid_balance − active_reservations − goal_allocations
```

### Budgets

Budgets are limits, not allocations. They read confirmed, non-deleted `expense` transactions in the period. Transfers (including credit card bill payments) are never expenses, so they never consume a budget.

## 4. Security model

- Passwords: Argon2id (m=19 MiB, t=2, p=1).
- Access token: HS256 JWT, 15 min, carries `sub`, `org`, `sid`. Every request checks that the session is not revoked.
- Refresh token: 32 random bytes, stored as SHA-256, single use, rotation chain (`family_id`). Reuse revokes the whole chain.
- Errors: a global filter returns generic 500s; SQL and stack traces only go to server logs, without request bodies.
- Validation: unknown fields are rejected; money must match `^\d{1,17}(\.\d{1,2})?$`.

## 5. Environments

| | Database | Notes |
|---|---|---|
| Local dev | PGlite (in-process) or `DATABASE_URL` | No Docker needed |
| Tests | PGlite in-memory, or `TEST_DATABASE_URL` for real Postgres | Same SQL |
| CI | PostgreSQL 16 service | Migrations + full suite on real Postgres |
| Production | PostgreSQL (`DATABASE_URL` required) | |
