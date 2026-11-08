# AI Handoff Log

Newest entry first. Each entry is self-contained: a reviewer should not need to have seen earlier code.

---

## HANDOFF-003 · Priority 3 gate fixes + Flutter step 1 (foundation and authentication)
**Date:** 2026-11-08 · **Branches:** `feature/reservation-lifecycle` (merged to `develop`), `feature/flutter-app` · **Implementer:** Claude

### Objective
Apply the ChatGPT architecture review (sections A–F) to the backend, validate on real PostgreSQL, then build the Flutter foundation and authentication only.

### 1. Files modified
**Backend, new:** `src/database/migrations/005_reservation_lifecycle.ts`, `006_goal_allocation.ts`, `007_account_tracking.ts`, `008_idempotency.ts`, `src/common/idempotency.service.ts`, `src/forecast/variable-spending.ts` (+ spec), `scripts/openapi-freeze.js`, `test/review-gate.e2e-spec.ts`, `test/api-contract.e2e-spec.ts`.
**Backend, changed:** `reservations.service.ts` / controller (lifecycle rewrite), `transactions.service.ts` / controller / DTO (tracking window, historical, sorting, idempotency, reversal hook), `goals.service.ts` / controller / DTO (allocation mode, bank movement, reversals, idempotency), `budget-period.ts`, `budgets.service.ts` (health), `forecast.service.ts` (rewrite), `financial-summary.service.ts` (reserve-mode goals only), `accounts.service.ts` / DTO (tracking start), `app.setup.ts` (uniform errors, OpenAPI builder), `config/env.ts` (forecast weights), `database/{schema.ts, migrator.ts}` (new tables, UTF-8 guard), tests adapted as listed in TEST_REPORT.md.
**Mobile, new:** the whole `mobile/` app (see `mobile/README.md`), `docs/screenshots/*`.
**Docs:** `ARCHITECTURE.md`, `DECISIONS.md` (D-015…D-022), `API_CONTRACT.md` (new), `api/openapi-v1.json` (new, frozen), `PROGRESS.md`, `TEST_REPORT.md`, `KNOWN_ISSUES.md`, this file. CI adds a Flutter job.

### 2. Database migrations (all reversible, applied/rolled back/re-applied on PostgreSQL 17.11)
| Migration | Change | Backfill |
|---|---|---|
| 005_reservation_lifecycle | `money_reservations.occurrence_date`, `created_from_reservation_id`, `close_reason`; unique live occurrence per commitment; unique live successor; new `reservation_settlements` | occurrence_date = due_date; settlements from reconciled rows |
| 006_goal_allocation | `financial_goals.allocation_mode` (`track_only` default); `goal_contributions.reverses_contribution_id`; unique reversal; unique linked transfer | existing goals → `reserve` (keeps prior behaviour) |
| 007_account_tracking | `bank_accounts.tracking_start_date` (NOT NULL); `opening_date` now nullable/informational; `transactions.is_historical` + source check | tracking_start_date = opening_date |
| 008_idempotency | `idempotency_keys` (owner, key) | — |
The upgrade path from pre-review data is covered by a test (`migrations › upgrades data written under the pre-review schema`).

### 3. API changes (contract frozen: `docs/api/openapi-v1.json`, conventions in `docs/API_CONTRACT.md`)
- New: `GET /reservations/:id/settlements`, `POST /goals/:id/contributions/:contributionId/reverse`.
- New fields: accounts `trackingStartDate`; transactions `historical` (request) / `isHistorical`; reservations `occurrenceDate`, `closeReason`, `createdFromReservationId`; goals `allocationMode`, `allocated`, `movedByTransfers`; contributions `type: reversal`, `reversed`; budgets `healthWarningFromPercent`; forecast `methodVersion`, `calculatedAt`, `variableSpending.method/windows`; list `sort`; responses `idempotentReplay`.
- New header: `Idempotency-Key` on `POST /transactions` and `POST /goals/:id/contributions`.
- Errors: every error body is `{ statusCode, code, message, fields?, details? }` (framework 401/403/404/429 now carry `code` too).
- Behaviour changes (approved): new goals are track-only; manual transactions before tracking start → 422 `before_tracking_start`; budget warning from the lowest threshold; future forecast `asOf` → 422.

### 4. Tests executed and results
- Backend: **104/104** on PGlite; **104/104** on PostgreSQL 17.11 (UTF-8), 3 runs. +34 tests since HANDOFF-002, including concurrency (reversal vs successor payment, concurrent deletes, concurrent idempotent requests) and an injected-fault rollback test.
- Mobile: `flutter analyze` clean; **24/24** widget/unit tests; **2/2** live integration tests against the running backend (incl. refresh-token reuse detection end to end).
- Manual walkthrough of the web build in a 375×812 viewport against the live backend (screenshots below).
- GitHub Actions: not run (no remote).

### 5. Outstanding issues
See `KNOWN_ISSUES.md`. Most relevant: KI-001 (CI never run), KI-016 (response schemas missing from OpenAPI), KI-017 (no emulator/device run yet), KI-004 (RLS deferred).

### 6. Screenshots of completed Flutter screens (`docs/screenshots/`)
| File | Shows |
|---|---|
| `01-sign-in.jpg` | Sign-in, visible labels, verb-first actions |
| `02-sign-in-validation.jpg` | Validation messages on submit |
| `03-register.jpg`, `04-register-filled.jpg` | Registration with password rule hint |
| `05-profile-after-real-registration.jpg` | Profile populated from the live `/auth/me` after a real registration |
| `06-profile-verification-resent.jpg` | Success banner after `POST /auth/resend-verification` |
| `07-profile-dark-mode.jpg` | Dark theme |
| `08-sign-out-all-devices-confirm.jpg` | Confirmation dialog naming the action |
| `09-offline-session-check.jpg` | Backend unreachable on launch: offline state, session kept, no unverified data shown |
| `10-forgot-password-offline-error.jpg` | Network failure shown with a recovery hint |

### 7. Decisions requiring further review
1. **D-019 / KI-019:** tracking start is immutable. Should users be able to move it earlier (re-basing the opening balance), or must older history always come in as historical imports?
2. **D-016:** recurring-vs-commitment de-duplication is heuristic (category or exact name). Acceptable until ingestion links transactions to commitments explicitly?
3. **D-018:** when a payment is reversed, the still-open successor is cancelled even if the user had topped it up. Should top-ups carry over to the reopened occurrence instead?
4. **KI-016:** add OpenAPI response schemas before Flutter step 2 (dashboard) — proposed yes; it adds contract coverage at the cost of DTO classes per endpoint.
5. **Offline mutations:** plan is a local queue of pending transactions shown as "Pending — not yet confirmed", replayed with their idempotency keys; never included in balances. Confirm before Flutter step 3.
6. **First signed-in screen:** until the dashboard exists, sign-in lands on Profile (no bottom navigation, to avoid non-functional tabs). OK for this step?

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
