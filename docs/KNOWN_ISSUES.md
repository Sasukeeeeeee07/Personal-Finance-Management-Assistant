# Known Issues and Limitations

Severity: **High** (wrong numbers or security exposure possible), **Medium** (incorrect in edge cases or missing safeguard), **Low** (cosmetic, performance, or by design but worth revisiting).

| ID | Severity | Area | Issue | Plan |
|---|---|---|---|---|
| KI-001 | Medium | Validation | CI on PostgreSQL 16 has never run (no Git remote). Real Postgres is validated only on 17.11 locally. | Push to GitHub; CI runs automatically. |
| KI-002 | Medium | Email | Mailer only logs messages; no real delivery, retry or background queue. | Priority 5 (SMTP + BullMQ). |
| KI-003 | Medium | Auth | Google Sign-In is implemented but untested with real Google tokens (no client ID). | Test once `GOOGLE_CLIENT_IDS` is configured. |
| KI-004 | Medium | Security | No Postgres row-level security; isolation relies on every query filtering by `owner_id` (covered by tests). | Add RLS as defence in depth (Priority 8). |
| KI-005 | Medium | Reservations | If the payment that settled a recurring reservation is deleted, the old reservation reopens while next period's reservation already exists, so both are held. Correct if the bill is genuinely unpaid, but may surprise users. | Product decision; show both clearly in the UI. |
| KI-006 | Low | Forecast | `asOf` shifts history windows and the month, but the starting balance is always the current balance. | Document in API; add as-of balances if historical forecasts are needed. |
| KI-007 | Low | Forecast | Expected recurring income/expenses rely on the user marking transactions as recurring; there are no recurring schedules yet. | Recurring schedules (pending in Phase 3 list). |
| KI-008 | Low | Budgets | Alerts are evaluated for the current period only; a back-dated expense never raises an alert for a past period. | By design (alerts are about now). |
| KI-009 | Low | Budgets | Alerts are evaluated after the transaction commits. If the process dies in between, the alert appears on the next evaluation (it is idempotent), not immediately. | Move to a queued job in Priority 5. |
| KI-010 | Low | Performance | Each transaction write re-evaluates all of the user's budgets (2 queries per budget). Fine for tens of budgets. | Batch or cache if profiling shows a problem. |
| KI-011 | Low | Data | Transactions dated before an account's opening date are accepted, which can double-count the opening balance. | Decide: reject, or warn. |
| KI-012 | Low | Time zones | All month and period boundaries use Asia/Kolkata. | Per-user time zone setting. |
| KI-013 | Low | Currency | Totals assume a single currency (INR). | FX support before multi-currency launch. |
| KI-014 | Low | Privacy | Audit log rows store full before/after snapshots (owner-scoped, never returned to other users) with no retention policy. | Define retention under DPDP; include in data export/deletion. |
| KI-015 | Low | Tooling | Jest needs `--experimental-vm-modules` because PGlite uses dynamic imports. | None needed; baked into `npm test`. |
