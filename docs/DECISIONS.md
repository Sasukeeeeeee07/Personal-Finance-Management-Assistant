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

### D-014 · Forecast is deterministic and states its assumptions — Superseded by D-016 · 2026-11-08
Variable spending = average daily discretionary expense over the last 90 days × days left. Expected income = income marked recurring last month that has not yet arrived this month. Each figure is returned with the rule that produced it.

---

## Review gate — Priority 3 (2026-11-08)

### D-006 · Card dues stay separate — Confirmed by review
Unreserved card dues must be shown prominently (`creditCardOutstanding` on the dashboard; Flutter shows it beside available-to-spend).

### D-010 · One-period, non-compounding rollover — Confirmed by review for v1.

### D-015 · Goal allocation is opt-in — Accepted · supersedes the allocation part of D-009
`financial_goals.allocation_mode` is `track_only` (default for new goals: progress only) or `reserve` (saved money reduces available-to-spend, unless the goal's account is non-liquid). Goals that existed before migration 006 were set to `reserve` to keep their behaviour. Each goal reports three separate figures: `saved` (progress), `allocated` (virtual allocation) and `movedByTransfers` (actual bank movement). A linked transfer must go into, or out of, the goal's own account for the same amount, and can back only one contribution. Corrections are opposite entries (`reverses_contribution_id`), never edits.

### D-016 · Forecast v2 — Accepted · revises D-014
Variable spending is a weighted daily average: last 7 days 50%, days 8–30 30%, days 31–90 20% (`FORECAST_VARIABLE_WEIGHTS`, initial values). Weights of windows without history are redistributed; with under 7 days of history a simple average is used. Planned, recurring and reservation-settling expenses are excluded. Recurring expenses that match an active commitment (by category or name) are counted once, as scheduled payments. `asOf` cannot be in the future; balances, open reservations and goal allocations are rebuilt as of that date. Responses carry `methodVersion`, `asOf`, `calculatedAt`, `assumptions` and `confidence`.

### D-017 · Idempotency keys — Accepted
An `Idempotency-Key` header (8–128 chars) is accepted on `POST /transactions` and `POST /goals/:id/contributions`. Keys are stored per user with a request fingerprint, claimed in the same DB transaction as the write. Same key and body → the original response (`idempotentReplay: true`). Same key, different body → 422 `idempotency_key_reused`. A concurrent duplicate waits, then replays, or gets 409 `idempotency_in_progress`.

### D-018 · Reservation lifecycle — Accepted (review B1)
Each reservation of a commitment has an `occurrence_date` (its identity, unique among live rows) and a `created_from_reservation_id` (the occurrence whose closing created it). `reservation_settlements` records every payment link, active or reversed. Reversing a payment (deleting it, unconfirming it or changing its type) marks the settlement reversed and reopens the occurrence. It also cancels that occurrence's still-open successor (`close_reason = superseded_by_payment_reversal`) and points the commitment back at the reopened occurrence. A successor that was already paid is kept, because it is a separate obligation. Lock order everywhere: transaction → reservation → commitment.

### D-019 · Tracking start date — Accepted (review B4)
`bank_accounts.tracking_start_date` (default today, India time) is the date the opening balance applies from. `opening_date` is now the informational bank opening date. Live transactions before tracking start → 422 `before_tracking_start`. Statement and aggregator imports may set `historical: true` for lines before tracking start: these count in analytics (budgets, reports, forecast history) but never in the ledger. Tracking start is not editable yet, because changing it would require re-basing the opening balance.

### D-020 · Budget health — Accepted (review B3)
`health` is `warning` from the lowest configured threshold (`healthWarningFromPercent`) and `exceeded` above 100%. Health is a state; threshold alerts are events, fired once per budget, period and threshold.

### D-021 · Notification delivery via an outbox — Proposed (review B6; implement in Priority 5)
Financial writes never wait on delivery. A write inserts outbox rows in the same DB transaction: owner, event type, a payload without sensitive text, dedupe key, status, attempts and next attempt time. A BullMQ worker delivers them (push, email, in-app), retries with backoff and records failures. A delivery failure can never roll back a financial write. `budget_alerts` already follows this pattern (`delivered_at`). Lock-screen text hides amounts by default.

### D-022 · Row-level security — Evaluated, deferred to Priority 8 (review B7)
Design: each request runs in a DB transaction that first runs `SET LOCAL app.user_id = '<uuid>'`. Every owner-scoped table gets a policy `USING (owner_id = current_setting('app.user_id')::uuid)`. The API connects as a role without `BYPASSRLS`; migrations and background jobs use a separate privileged role and set the user explicitly per job.

Risks to test before enabling:
- Pooled connections leaking the setting. Mitigation: use `SET LOCAL`, inside transactions only.
- Reads outside transactions: many reads are not wrapped in one today, so they would need to be.
- The PGlite dev path runs as superuser, so RLS would be silently bypassed in local development.

Not enabled now, to avoid destabilising the owner-scoped authorization that the tests cover. Target: behind a feature flag, with a pooled-connection isolation test.

---

## HANDOFF-003 decisions — resolved 2026-11-08
HANDOFF-003 was approved by the reviewer without objection to the implementer's proposals below, so each proposal is recorded as the resolution. Any of them can be reopened by the product owner.

| # | Question | Resolution |
|---|---|---|
| 1 | Can `tracking_start_date` be moved? (D-019, KI-019) | **No, immutable in v1.** Older history comes in as explicit historical imports. A re-basing flow (new opening balance at an earlier date) is backlog, only if users ask for it. |
| 2 | Is the recurring-vs-commitment de-duplication heuristic acceptable? (D-016) | **Yes, until ingestion links transactions to commitments explicitly** (Priority 6). Tracked as KI-020. |
| 3 | On payment reversal, carry a successor's top-up over? (D-018) | **No.** The still-open successor is cancelled (audited); the reopened occurrence keeps its own reserved amount. Successors are created fully reserved, so a top-up can only happen after a manual reduction, which is rare. |
| 4 | Add OpenAPI response schemas before the dashboard? (KI-016) | **Yes — done** for the 10 dashboard endpoints, enforced by a response contract test (D-023). |
| 5 | Offline mutation design for Transactions | **Confirmed:** a local queue of pending entries shown as "Pending — not yet confirmed", replayed with their idempotency keys, never included in balances. Implemented in Flutter step 3, after dashboard approval. |
| 6 | First signed-in screen | **Superseded:** sign-in now lands on the Dashboard. Bottom navigation shows only the destinations that exist (Home, Profile); Transactions, Budget and Goals tabs and the quick-add button are added with their modules, so there are no non-functional controls. |

### D-023 · Response contract enforcement — Accepted
Response schemas live in `backend/src/api-responses.ts` and are attached with `@ApiOkResponse`. The response contract test compiles the frozen OpenAPI schemas with Ajv (`nullable` → null branch, `additionalProperties: false` on every object) and validates real responses. Adding, removing or retyping a field fails the build until the contract is re-frozen and logged in `API_CONTRACT.md`.

### D-024 · Server-computed comparison fields — Accepted
The dashboard needs a net position and a "month-end vs now" comparison. Both are computed on the backend (`netPosition`, `availableNow`, `availableChangeByMonthEnd`) rather than in the app, so the backend stays the only source of financial arithmetic. `availableNow` uses the same as-of reconstruction as the forecast, and equals the dashboard's `availableToSpend` when `asOf` is today (covered by a test).
