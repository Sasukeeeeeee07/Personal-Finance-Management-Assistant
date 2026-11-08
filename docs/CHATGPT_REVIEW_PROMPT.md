You are the architecture consultant, technical reviewer and QA reviewer for a Personal Finance Management SaaS ("Allocate first. Spend second."). Claude is the implementation agent. You have not seen the code, so everything you need is below. Please review it and answer the questions at the end.

## Stack as built
- Backend: NestJS 11, TypeScript, Node 20, REST under /api/v1, Swagger at /api/docs.
- Database: PostgreSQL via Kysely 0.28 (typed SQL builder) with hand-written SQL migrations. No ORM. When no DATABASE_URL is set, local dev and tests use PGlite (real Postgres compiled to WASM). Production refuses to start without DATABASE_URL.
- Money is NUMERIC(19,2) in the database, decimal.js in code, and strings over the API ("8000.00"). Floating point is never used.
- Flutter and Next.js apps are not started yet.

## Already done before this round (Phases 1–2 and Money Lock foundation)
- Auth: email/password, Google ID-token sign-in, email verification, forgot/reset password, Argon2id, 15-min JWT access tokens, refresh-token rotation with reuse detection, logout from one or all devices.
- RBAC: Super Admin, Org Admin and Standard User; permissions stored as data. Every financial query is scoped to the owner, so other users' records return 404. Org admins cannot see members' finances.
- Accounts (8 types; only the last 4 digits are stored), income, expenses, transfers.
- Append-only ledger: balance = opening balance + Σ ledger entries. Edits and deletes post reversing entries. Only confirmed transactions count.
- Credit card purchase = expense on the card. Bill payment = transfer from bank to card, so it is not a second expense.
- Dedup: the same bank reference on the same account is stored as a duplicate. An auto-captured match on amount within ±10 min goes to "needs review".
- Money Lock: commitments plus full or partial reservations. Paying a reserved bill settles the reservation in the same DB transaction, so there is no double deduction. The next occurrence is reserved automatically.
- available_to_spend = liquid_balance − active_reservations − goal_allocations

## What was done in this round
**Git:** baseline commit on main, work on feature/budget-management, merged into develop.

**Budgets** (new)
- Overall or per-category; periods monthly, weekly or custom (N days).
- A monthly budget resets on the day of the month of its start date, clamped in short months (31st → 28/29/30).
- Spending counts only confirmed, non-deleted expense transactions, using India-time period boundaries. Transfers and card bill payments never count.
- Each budget reports limit, spent, remaining, utilisation %, days left, daily target, thresholds reached and health (on_track / warning at ≥75% / exceeded).
- Optional rollover: limit = amount + max(0, amount − previous period's spending). It covers one period and does not compound.
- Configurable thresholds (default 50/75/90/100) plus a separate "exceeded" alert. Each fires once per period, enforced by a DB unique key. Alerts are stored as events for the future notification engine.
- Transaction responses now include the alerts they triggered and the budget impact.
- One active budget per category (or overall) per period type. Period and start date are immutable; to change them, archive and recreate.

**Savings goals** (new)
- Target, target date, monthly contribution, priority 1–3, optional linked account, opening amount.
- Contributions and withdrawals are allocations. They never touch the ledger, so they are never income or expense.
- Saved money reduces available-to-spend, unless the goal's account is non-liquid (e.g. a fixed deposit). Archiving releases it.
- Goals auto-complete when the target is reached and reactivate if money is withdrawn. Withdrawals can't exceed what was saved (row lock).
- Projections: progress %, recommended monthly amount (rounded up), estimated completion (from the planned contribution, else the 3-month average pace), on-track flag.

**Month-end forecast** (new, deterministic)
- Formula: liquid balance + expected recurring income − scheduled payments − expected recurring expenses − variable spending.
- Scheduled payments = open reservations due this month + later occurrences of commitments this month.
- Recurring income and expenses = items marked recurring last month that haven't occurred yet this month.
- Variable spending = average daily non-recurring expense over up to 90 days × days left.
- Every response includes plain-language assumptions and a confidence level.

**Dashboard** now also returns savings, goal allocations and the remaining overall monthly budget.

**Database and testing**
- Migration 004 adds 4 new tables. All migrations now have down scripts, and `migrate -- --down` rolls back the latest one.
- Tests: 70 total (35 original + 35 new). The new ones cover critical case #11 (monthly reset, including a midnight case in India time), concurrency (duplicate bank reference sent 5× at once, double settlement, concurrent withdrawals), failure rollback, DB-level constraints and migration rollback.
- Results: 70/70 on PGlite, and 70/70 on real PostgreSQL 17.11 run locally (3 consecutive runs; migrate → rollback → re-apply succeeded).
- The GitHub Actions workflow (PostgreSQL 16 service, readiness wait, migrate, rollback check, tests, build) is written but has never run, because the repo has no remote yet. PG 16 compatibility is not claimed.

**Docs added:** ARCHITECTURE.md, DECISIONS.md (D-001 to D-014), AI_HANDOFF.md, TEST_REPORT.md and KNOWN_ISSUES.md (KI-001 to KI-015). PROGRESS.md and IMPLEMENTATION_PLAN.md are updated.

## Known issues worth your attention
- No Postgres row-level security yet; isolation relies on owner filtering, which is covered by tests.
- Email is log-only for now (SMTP comes in Priority 5).
- Google Sign-In is untested with real tokens.
- If the payment that settled a recurring reservation is deleted, the old reservation reopens while next period's reservation already exists, so both are held.
- Transactions dated before an account's opening date are accepted.
- Budget alerts are evaluated right after the transaction commits, not in a queue.
- The forecast always starts from the current balance, even when asOf is set.

## Questions for your review
1. Should credit card dues be subtracted from available-to-spend automatically? Currently they are shown separately, and the user reserves for the bill through a commitment, to avoid double subtraction.
2. Is one-period, non-compounding rollover the right default, or should it accumulate up to a cap?
3. Should goal savings always reduce available-to-spend (current behaviour), or only when the user opts in per goal?
4. Should the budget "warning" status start at ≥75%, or at the lowest configured threshold?
5. Should a transaction dated before the account's opening date be rejected, or allowed with a warning?
6. Is a 90-day average of non-recurring spending acceptable for forecast v1, or should recent weeks be weighted more?
7. Any concerns with the data model (budgets, budget_alerts, financial_goals, goal_contributions) before the Flutter app is built on these APIs?

## Next planned step (Priority 3)
Flutter MVP, Android first:
- Riverpod, GoRouter, Material 3 (light and dark), tokens in secure storage.
- One Dio API client with single-flight refresh-token rotation. Amounts are never parsed as double.
- Bottom navigation: Home, Transactions, Budget, Goals, Profile, plus a quick-add button.
- Every screen bound to the real API, with loading, empty, error and offline states.

Please flag anything in this plan you would change before work starts.
