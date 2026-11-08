# Development Progress

Last updated: 2026-11-08 · Evidence for every "tested" claim is in [TEST_REPORT.md](TEST_REPORT.md).

## Completed (tested)

### Phase 1 — Foundation (backend)
- [x] NestJS 11 API, `/api/v1`, Swagger at `/api/docs`
- [x] PostgreSQL schema, reversible SQL migrations (`npm run migrate`, `npm run migrate -- --down`), idempotent reference seed
- [x] PGlite fallback for local dev; production refuses to start without `DATABASE_URL`
- [x] Auth: register, login, Google ID token (untested with real tokens, KI-003), email verification, forgot/reset, logout (one/all devices), session list/revoke
- [x] Argon2id; refresh-token rotation with reuse detection; per-request session check
- [x] RBAC (Super Admin, Org Admin, Standard User) as data; permission guard
- [x] Per-user financial isolation; org admins cannot see members' finances
- [x] Rate limiting, helmet, strict validation, safe error responses

### Phase 2 — Financial core (backend)
- [x] Accounts (8 types), masking, archive, reconcile against bank balance
- [x] Income / expense / transfer on an append-only ledger with reversals
- [x] Credit card purchase and bill settlement
- [x] Statuses, exact + fuzzy dedup, optimistic locking, audit history
- [x] Custom categories; expense insight (month vs last month, budget impact)

### Phase 3 — Financial management (backend)
- [x] Money Lock: commitments, full/partial reservations, release, cancel, overdue, overcommitted, atomic settlement, next-period auto-reservation
- [x] Budgets: overall/category; monthly (configurable reset day), weekly, custom; utilisation, remaining, daily target; rollover; configurable threshold alerts + exceeded alert, once per period
- [x] Goals: create/edit/complete/archive, contributions/withdrawals as allocations, auto-complete, projections
- [x] Month-end forecast with explicit assumptions
- [x] Dashboard: total balance, reserved, allocated, available-to-spend, card dues, month income/expenses, savings, remaining monthly budget, upcoming payments

### Validation
- [x] 70 tests pass on PGlite
- [x] 70 tests pass on **real PostgreSQL 17.11** (local); migrations apply, roll back and re-apply
- [ ] CI on PostgreSQL 16 (GitHub Actions) — workflow ready, never run (no remote) — **blocker for claiming PG 16**

## Pending (in priority order)
1. ~~Budgets and goals~~ ✅
2. Real PostgreSQL in CI — run once a GitHub remote exists
3. **Flutter MVP** (Android first): auth, dashboard, accounts, transactions, Money Lock, budgets, goals, profile; quick-add
4. **Next.js dashboard**: same modules + reports
5. SMTP email service (templates, retry, BullMQ) and Firebase push (device tokens, preferences, quiet hours)
6. Transaction automation: adapters, CSV/XLSX/PDF import, Android SMS / notification capture, categorisation rules
7. Deterministic insights + discipline score; optional Ollama coach behind a provider interface
8. SaaS plans/entitlements, billing abstraction (Razorpay later), Super Admin dashboard, production hardening

Also pending from Phase 3: recurring income/expense schedules, receipt attachments.

## Blocked / needs the product owner
- **GitHub remote** — needed for CI to run.
- **SMTP credentials** (Gmail app password for dev, Brevo/SES for prod).
- **Firebase project** (`google-services.json`, Admin SDK service account) for push.
- **Google OAuth client IDs**.
- **Account Aggregator partner** contract; **Razorpay** onboarding.
- Decisions requested in `AI_HANDOFF.md` → HANDOFF-002 questions.

## Production blockers (not production-ready)
CI on PostgreSQL 16 · RLS / encryption-at-rest configuration · email delivery tests · push tests · mobile and web builds · backup and restore drill · monitoring/error tracking · load and concurrency testing at scale · data export and account deletion · consent records · security review.
