# Development Progress

Last updated: 2026-11-08

## Completed (tested)

### Phase 1 — Foundation (backend)
- [x] Monorepo layout, implementation plan (`docs/IMPLEMENTATION_PLAN.md`)
- [x] NestJS 11 API, `/api/v1` prefix, Swagger at `/api/docs` (30 paths)
- [x] PostgreSQL schema with SQL migrations + idempotent reference seed (roles, permissions, 24 system categories)
- [x] Embedded PGlite fallback when `DATABASE_URL` is unset (no Docker on dev machine)
- [x] Auth: register, email/password login, Google ID-token sign-in, email verification, forgot/reset password, logout (one device / all devices), session list + revoke
- [x] Argon2id password hashing; refresh-token rotation with reuse detection (revokes the family)
- [x] Access tokens rejected immediately after logout/reset (session check per request)
- [x] RBAC: roles / permissions / role_permissions as data; `@RequirePermissions()` guard; Super Admin, Org Admin, Standard User
- [x] Tenant isolation: every financial query is scoped by owner; other users' records return 404
- [x] Org admins can manage members but get no access to members' finances
- [x] Rate limiting (stricter on credential endpoints), helmet, strict validation (unknown fields rejected), safe error filter (no stack traces or SQL in responses)

### Phase 2 — Core financial system (backend)
- [x] Accounts: savings, current, cash, UPI bank, credit card, wallet, FD, other; opening balance; masked number (last 4 digits only); archive; delete only if unused
- [x] Account reconciliation (tracked vs bank balance, with an explanation of the gap)
- [x] Income, expenses, transfers; append-only ledger (edits/deletes post reversing entries)
- [x] Credit card: purchase = expense on card; bill payment = transfer (settles the liability, not a second expense); outstanding + available credit
- [x] Statuses: confirmed / needs_review / duplicate / ignored / failed; only confirmed transactions affect balances
- [x] Dedup: exact (same account + bank reference) → duplicate; fuzzy (automatic source, same amount ±10 min) → needs_review
- [x] Edit with optimistic locking (`version`), full audit history per transaction
- [x] Custom categories; essential/non-essential default from category
- [x] Expense intelligence: category spend this month vs last month

### Phase 3 (partial) — Money Lock
- [x] Commitments (once / weekly / monthly / yearly / every N days) with anchor-day month handling
- [x] Reservations: full, partial, top-up, release, cancel; overdue flag; overcommitted warning
- [x] Settle by paying with `reservationId` or linking an existing transaction; amount mismatch must be confirmed
- [x] Next occurrence reserved automatically after settlement; deleting the payment re-holds the reservation
- [x] Dashboard summary: total balance, liquid balance, reserved, available-to-spend, card dues, month income/expenses, review queue, upcoming payments, formula explanation

### Tests — 35 passing (`cd backend && npm test`)
Critical cases covered: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12. Plus auth, token rotation/reuse, email verification, password reset, RBAC, validation.

## Pending
- [ ] **Web app** (Next.js): auth screens, dashboard, accounts, transactions, Money Lock
- [ ] **Flutter app**: auth (+ biometric unlock), Home / Transactions / Budget / Goals / Profile, quick-add
- [ ] Phase 3: budgets (+ alerts, carry-forward, reset dates; test case 11), goals + goal allocations in available-to-spend
- [ ] Phase 3: attachments (receipts) on object storage
- [ ] Phase 3: recurring income/expense schedules (auto-generated transactions)
- [ ] Phase 4: analytics endpoints, charts, monthly/yearly reports, PDF/CSV export
- [ ] Phase 5: ingestion adapters, CSV/XLSX/PDF statement import, Android SMS/notification capture, BullMQ jobs, reminders, categorisation rules + learning
- [ ] Phase 6: AI coach (grounded in the user's real data), insights, education feed, smart alerts
- [ ] Phase 7: plans, Razorpay subscriptions, Super Admin dashboard
- [ ] Phase 8: Postgres RLS (defence in depth), encryption-at-rest config, data export, account deletion, monitoring, load tests

## Blocked / needs a decision
- **Docker / PostgreSQL not installed** on the dev machine. Tests run on embedded PGlite (real Postgres). `docker-compose.yml` is ready for when Docker is available.
- **Email delivery**: the dev mailer only logs messages. Production needs an SMTP/SES provider and credentials.
- **Google Sign-In**: needs OAuth client IDs (`GOOGLE_CLIENT_IDS`).
- **Account Aggregator**: needs a contract with a regulated AA/FIU partner (e.g. Setu, Finvu). The app will not act as an AA itself.
- **Razorpay**: needs merchant onboarding and API keys.
- **AI coach**: needs a model provider API key.

## Known limitations
- No cross-currency aggregation (all totals assume one currency, INR).
- Month boundaries use India Standard Time; a per-user timezone setting is pending.
