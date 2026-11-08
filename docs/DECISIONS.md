# Decision Log

Each entry: ID, date, status, decision, reason, consequences. Status is **Accepted** (in code), **Proposed** (awaiting product owner / reviewer) or **Superseded**.

---

### D-001 · Kysely + hand-written SQL migrations (no ORM) — Accepted · 2026-11-08
Typed queries with explicit SQL for financial logic. Kysely 0.28 is pinned because 0.29 is ESM-only and the NestJS build is CommonJS on Node 20.14.

### D-002 · PGlite when `DATABASE_URL` is unset — Accepted · 2026-11-08
The dev machine has no Docker or PostgreSQL. PGlite is real PostgreSQL compiled to WASM, so the SQL is identical. Production refuses to start without `DATABASE_URL`. Real PostgreSQL compatibility is only claimed after CI (or a local real-Postgres run) passes; see TEST_REPORT.md.

### D-003 · Money as NUMERIC(19,2), strings over the API — Accepted · 2026-11-08
No floating point anywhere. Clients send and receive `"8000.00"`.

### D-004 · Balances derived from an append-only ledger — Accepted · 2026-11-08
Edits and deletions post reversing entries. Only `confirmed` transactions have entries.

### D-005 · Credit cards are liability accounts; bill payment is a transfer — Accepted · 2026-11-08
Purchase = expense on the card. Payment = transfer bank → card. Prevents counting the expense twice.

### D-006 · Credit card dues are not subtracted from available-to-spend — Accepted · 2026-11-08 · *review requested*
Dues are shown separately. The user reserves for the card bill with a commitment. Subtracting dues automatically as well would double-count when a commitment exists. Alternative for review: subtract dues automatically and forbid commitments targeting card accounts.

### D-007 · Reservations may exceed available money — Accepted · 2026-11-08
The app reports `overcommitted: true` and a negative available-to-spend instead of refusing. Bills exist whether or not the money does.

### D-008 · Month boundaries use Asia/Kolkata — Accepted · 2026-11-08
Until a per-user timezone setting exists.

### D-009 · Budgets are limits, goals are allocations — Accepted · 2026-11-08
A budget does not reduce available-to-spend; it measures spending against a limit. Goal savings do reduce available-to-spend (money is earmarked), unless the goal is linked to a non-liquid account (e.g. a fixed deposit), whose balance is already outside the liquid balance.

### D-010 · Budget rollover is one period, non-compounding — Accepted · 2026-11-08 · *review requested*
With rollover on, the limit for a period = amount + max(0, previous period's base amount − previous period's spending). The previous period's own rollover is not carried again. This keeps the number explainable and prevents unbounded accumulation.

### D-011 · Monthly budget reset day = day of the budget's start date — Accepted · 2026-11-08
A budget starting on the 15th runs 15th → 14th each month. Days past the end of a short month are clamped (31 → 28/29/30).

### D-012 · Budget alerts are stored as events, delivered later — Accepted · 2026-11-08
`budget_alerts` records each (budget, period, threshold) once. The notification engine (Priority 5) will deliver these events; until then they are returned by the API. The unique key prevents repeated alerts.

### D-013 · Goal contributions are allocations, not transactions — Accepted · 2026-11-08
Recording a contribution does not create income or expense. If the user physically moves money to a savings account, they record a transfer separately (optional link via `transaction_id`).

### D-014 · Forecast is deterministic and states its assumptions — Accepted · 2026-11-08
Variable spending = average daily discretionary expense over the last 90 days × days left. Expected income = income marked recurring last month that has not yet arrived this month. Each figure is returned with the rule that produced it.
