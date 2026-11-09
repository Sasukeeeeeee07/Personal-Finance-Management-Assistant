# Development Progress

Last updated: 2026-11-09 · Branch `feature/mvp-completion` (not pushed) · Evidence for every "tested" claim is in
[TEST_REPORT.md](TEST_REPORT.md).

**Direction (2026-11-09):** personal use only. No subscriptions, billing, SaaS onboarding, tenant management or
organization administration. Hosting at ₹0/month: Vercel Hobby (web), Render Free (API), Neon Free (PostgreSQL).
The OCI/Docker ARM64 plan is dropped. See [DEPLOYMENT.md](DEPLOYMENT.md).

Statuses: COMPLETE · PARTIALLY COMPLETE · NOT STARTED · BLOCKED · NOT VERIFIED

## MVP modules

| # | Module | Status | Notes |
|---|---|---|---|
| 1 | Transactions + quick add | **COMPLETE** | List with type filters and paging; add / edit / delete (confirmed); expense, income, transfer; idempotency keys reused on retry, regenerated when the request changes; field errors from the API; quick-add button on Home. Offline queue not built (see KI-024). |
| 2 | Accounts + transfers | **COMPLETE** | Grouped list (spendable / cards / savings), add, detail with history, reconcile against the bank, archive (confirmed), transfer, **pay card bill** (card preselected; a transfer, not an expense). |
| 3 | Money Lock | **COMPLETE** | Add commitment (reserves now), mark paid (expense + settlement in one atomic request; different amount asks first), change amount, release (confirmed), cancel commitment (confirmed). |
| 4 | Budgets | **COMPLETE** | Overall or per category; monthly, weekly or every N days; first period start date; carry-forward; change the limit; archive (confirmed). |
| 5 | Goals | **COMPLETE** | Track-only or set-aside, add money (idempotent), withdraw, reverse a contribution, mark reached, archive. |
| 6 | Reports | **COMPLETE** | Monthly: income, spending, savings rate, by category, essential vs non-essential, planned vs unplanned, largest expenses, comparison with the previous month. New backend endpoint `GET /reports/monthly`. |
| 7 | Profile + settings | **PARTIALLY COMPLETE** | Profile, links to accounts and reports, sign out, sign out of all devices (confirmed). Not built (app **and** API): editing your name, changing password while signed in (today: "forgot password", which needs SMTP), biometric lock (KI-018), theme override (follows the system). KI-025. |
| 8 | Auth end to end | **COMPLETE** (email/password) | Register, login, refresh rotation, restore after a page refresh (returns to the page you were on), forgot / reset password and verify email screens reached from email links. Google sign-in: **NOT STARTED** in the app (KI-003). Email delivery needs SMTP settings (optional). |

Every module has loading, empty, success and error states with retry, validates input, confirms destructive
actions and refreshes the affected figures after a change. Verified in widget tests and in Chrome at 375×812 and
1280×800 (TEST_REPORT, 2026-11-09).

## Financial rules (unchanged, enforced by the backend and covered by tests)
Backend is the source of truth · append-only ledger · transfers are neither income nor expense · card bill payments
are transfers, not expenses · reservations settle atomically · idempotency keys on money writes · every query scoped
to the signed-in owner · pending/needs-review transactions never touch confirmed balances.

## Deployment readiness

| Item | Status |
|---|---|
| Render Blueprint (`render.yaml`), Vercel SPA config (`mobile/web/vercel.json`), `backend/.env.example` (placeholders only), `docs/DEPLOYMENT.md` | **COMPLETE** |
| Production start-up locally (`NODE_ENV=production`, real PostgreSQL 17.11): migrations, `/health/ready`, docs off, CORS allow-list, refusal on bad config | **COMPLETE** (verified) |
| Concurrent start-up (overlapping deploys) | **COMPLETE**: migrations and seeding serialized with an advisory lock; tested with 3 concurrent instances on real PostgreSQL |
| Flutter web release build with `vercel.json` included | **COMPLETE** (verified) |
| Actual Vercel / Render / Neon deployment | **NOT STARTED** (needs the owner's accounts; deliberately not done) |
| CI run of this branch | **NOT VERIFIED** (branch not pushed; `main` CI is green incl. PostgreSQL 16) |
| Docker ARM64 / OCI | **Not applicable** (dropped with the direction change) |

## Infrastructure

| Item | Status |
|---|---|
| GitHub Actions CI on `main` (backend, PostgreSQL 16, Flutter) | **COMPLETE** (green) |
| Android debug APK | Built 2026-11-08 (dashboard version); not rebuilt for the MVP modules: **NOT VERIFIED** |
| Android emulator / iOS run | **BLOCKED** (Android cmdline-tools missing; iOS needs macOS), KI-017 |

## Next
1. Owner: review this branch, push it, let CI run, merge.
2. Owner: create the Neon / Render / Vercel projects and follow DEPLOYMENT.md (≈30 minutes).
3. Next build task: `PATCH /auth/me` (name) and `POST /auth/change-password` (current + new password, revokes
   other sessions) with their Profile screens (KI-025), then the offline entry queue (KI-024).
