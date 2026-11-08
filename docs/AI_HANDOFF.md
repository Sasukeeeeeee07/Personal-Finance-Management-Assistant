# AI Handoff Log

Newest entry first. Each entry is self-contained: a reviewer should not need to have seen earlier code.

---

## HANDOFF-002 · Priorities 1 & 2 — Budgets, goals, forecast; real PostgreSQL validation
**Date:** 2026-11-08 · **Branch:** `feature/budget-management` (merged to `develop`) · **Implementer:** Claude

### Objective
Complete Phase 3 (budgets, financial goals, forecasting, critical test #11) and validate the schema and test suite on real PostgreSQL.

### What was implemented
**Budgets** (`backend/src/budgets/`)
- Overall or category budgets; periods `monthly` (reset day = day-of-month of `startDate`, clamped in short months), `weekly`, `custom` (N days).
- Per period: limit, carried over, spent, remaining, utilisation %, days left, daily target, thresholds reached, health (`on_track` / `warning` ≥75% / `exceeded`).
- Spending = confirmed, non-deleted **expense** transactions in the period (India time). Transfers and card bill payments never count.
- Optional rollover: one period, non-compounding (`limit = amount + max(0, amount − previous spent)`).
- Configurable thresholds (default 50/75/90/100) plus a separate "exceeded" alert. Each fires **once per period** (DB unique key). Alerts are stored in `budget_alerts` for the future notification engine.
- Transaction responses now include `budgetAlerts`; transaction detail includes `insight.budget` (budget impact).
- One active budget per (category or overall, period type); period and start date are immutable (archive and recreate).

**Goals** (`backend/src/goals/`)
- Create, edit, complete, archive; kind, target, target date, monthly contribution, priority (1–3), optional account, opening amount.
- Contributions and withdrawals in `goal_contributions`. They **never** touch the ledger, so they are never income or expense.
- Saved money reduces available-to-spend (`allocated`) unless the goal's account is non-liquid (e.g. a fixed deposit). Archiving releases it.
- Auto-complete when saved ≥ target; withdrawing below the target reactivates. Withdrawals cannot exceed saved (row lock).
- Projections: progress %, remaining, recommended monthly (rounded up), estimated completion (planned contribution, else 3-month average pace), on-track flag.

**Forecast** (`backend/src/forecast/`) — `GET /forecast/month-end`
- `startingLiquidBalance + expectedIncome − scheduledPayments − expectedRecurringExpenses − variableSpending`.
- Scheduled payments = open reservations due this month + later occurrences of active commitments this month.
- Expected recurring income and expenses = items marked recurring last month that have not occurred yet this month.
- Variable spending = average daily non-recurring expense over up to 90 days (excluding payments that settled reservations) × full days left.
- Every response lists its assumptions in plain language and a confidence level.

**Dashboard summary** now adds `savings`, `allocated` (goal savings), and `monthlyBudget` (overall monthly budget remaining).

**Database / tooling**
- Migration `004_budgets_goals`. All migrations now have `down` scripts; `npm run migrate -- --down` rolls back the latest.
- Test harness runs against real PostgreSQL when `TEST_DATABASE_URL` is set.
- CI rewritten: PostgreSQL 16 service → readiness wait → migrate → rollback/re-apply → full suite → build; plus a PGlite job.

### Files modified
New: `src/budgets/{budget-period.ts, budget-period.spec.ts, budget.dto.ts, budgets.service.ts, budgets.controller.ts}`, `src/goals/{goal.dto.ts, goals.service.ts, goals.controller.ts, goals.spec.ts}`, `src/forecast/forecast.service.ts`, `src/database/migrations/004_budgets_goals.ts`, `test/budgets-goals.e2e-spec.ts`, `test/migrations.e2e-spec.ts`, `docs/{ARCHITECTURE, DECISIONS, AI_HANDOFF, TEST_REPORT, KNOWN_ISSUES}.md`, `.gitattributes`.
Changed: `src/app.module.ts`, `src/dashboard/financial-summary.service.ts`, `src/transactions/transactions.service.ts`, `src/database/{schema.ts, migrator.ts, migrate.cli.ts}`, migrations 001–003 (added `down` only; `up` untouched), `test/helpers.ts`, `.github/workflows/ci.yml`, `.gitignore`.

### Database changes
New tables: `budgets`, `budget_alerts`, `financial_goals`, `goal_contributions`. No existing table altered.

### API changes (all under `/api/v1`, all owner-scoped)
- `GET/POST /budgets`, `GET/PATCH/DELETE /budgets/:id` (`?asOf=YYYY-MM-DD` on GETs), `GET /budgets/alerts`
- `GET/POST /goals`, `GET/PATCH /goals/:id`, `POST /goals/:id/contributions`, `POST /goals/:id/complete`, `POST /goals/:id/archive`
- `GET /forecast/month-end?asOf=`
- Additive fields: `POST /transactions` → `budgetAlerts`; `GET /transactions/:id` → `insight.budget`; `GET /dashboard/summary` → `savings`, `monthlyBudget`; reservation `position` objects unchanged.
- No breaking changes.

### Architectural decisions
D-009 (budgets are limits, goals are allocations), D-010 (rollover rule), D-011 (reset day), D-012 (alerts stored as events), D-013 (contributions are not transactions), D-014 (forecast rules). See `DECISIONS.md`.

### Tests executed and results
- PGlite: 70/70 passed (was 35).
- Real PostgreSQL 17.11 (local, `embedded-postgres`): 70/70 passed, 3 runs; migrate → rollback → re-apply succeeded.
- GitHub Actions: not run (no remote).

### Security considerations
- Every new query filters by `owner_id`; cross-user access returns 404 (tested for budgets, goals, categories, accounts).
- A user cannot create a budget on another user's custom category, or link a goal to another user's account.
- Withdrawals and settlements use `SELECT … FOR UPDATE`; concurrency tests pass on real Postgres.
- Alert messages contain amounts; when push notifications are added, lock-screen text must hide amounts by default.

### Known issues
KI-005 to KI-011 in `KNOWN_ISSUES.md` relate to this work.

### Outstanding work
Recurring income/expense schedules, receipt attachments, Priority 3 (Flutter MVP) onward.

### Questions for ChatGPT review
1. **D-006**: should credit card dues be subtracted from available-to-spend automatically?
2. **D-010**: is one-period, non-compounding rollover the right default, or should rollover accumulate with a cap?
3. **Goal allocation**: saved goal money reduces available-to-spend even when it sits in the same savings account the user spends from. Is that the desired "allocate first" behaviour, or should it be opt-in per goal?
4. **Budget health**: is ≥75% the right "warning" cutoff, or should it be the lowest configured threshold?
5. **KI-011**: reject or warn when a transaction predates the account's opening date?
6. **Forecast**: is a 90-day average of non-recurring spending acceptable for v1, or should it weight recent weeks more?

---

## HANDOFF-001 · Phases 1–2 and Money Lock foundation
**Date:** 2026-11-08 · **Commit:** `2325310` (baseline)

Implemented the NestJS backend: auth (email/password, Google ID token, email verification, password reset, Argon2id, refresh rotation with reuse detection, session revocation), RBAC, per-user isolation, accounts, append-only ledger, income/expense/transfer, credit card accounting, dedup, audit history, commitments and reservations with atomic settlement, dashboard summary. 35 tests on PGlite. See `ARCHITECTURE.md` and `DECISIONS.md` D-001 to D-008.
