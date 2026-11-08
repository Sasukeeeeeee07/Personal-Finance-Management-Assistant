# Development Progress

Last updated: 2026-11-08 · Evidence for every "tested" claim is in [TEST_REPORT.md](TEST_REPORT.md).

## Completed (tested)

### Backend — Phases 1–3
- [x] Auth, sessions, RBAC, per-user isolation (Phase 1)
- [x] Accounts, ledger, transfers, credit cards, dedup, audit (Phase 2)
- [x] Money Lock, budgets, goals, forecast, dashboard (Phase 3)

### Review gate (ChatGPT, Priority 3 gate)
- [x] B1 Reservation lifecycle: occurrence identity, settlement links, successor tracking, reversal restores state, DB uniqueness, concurrency + failure rollback tests
- [x] B2 Goal allocation opt-in (`track_only` default / `reserve`), linked transfers, reversals
- [x] B3 Budget health from the lowest threshold; events separate and idempotent
- [x] B4 Tracking start date; manual back-dating rejected; explicit historical imports
- [x] B5 Forecast v2: as-of correctness, 50/30/20 weighting (configurable), no double counting, method metadata
- [x] B6 Outbox design recorded (D-021); budgets already independent of delivery
- [x] B7 RLS evaluated (D-022), deferred
- [x] E API contract: uniform errors, sorting, idempotency keys, frozen OpenAPI + snapshot test (docs/API_CONTRACT.md)
- [x] 104 backend tests pass on PGlite and on real PostgreSQL 17.11

### Flutter — step 1: foundation and authentication
- [x] Project (`mobile/`), Material 3 light/dark theme with design tokens
- [x] `ApiClient`: single-flight refresh rotation, one retry on 401, timeouts, cancellation, structured `ApiError`, idempotency keys
- [x] Secure token storage; `Money` with exact decimals and Indian grouping
- [x] Sign in, register (server field errors on fields), forgot password, session restore, offline state, profile with email verification, sign out (this device / all devices)
- [x] 24 widget/unit tests + 2 live API integration tests; web build walkthrough with screenshots

## Next (in order)
1. Flutter step 2 — **Dashboard** (needs response schema for `/dashboard/summary`, KI-016) with bottom navigation and quick-add
2. Flutter step 3 — Transactions (list with sort/paging, add/edit, offline queue with idempotency keys — pending entries never shown as confirmed)
3. Flutter step 4 — Money Lock (commitments, reservations, settlement, reversal UI)
4. Flutter steps 5–7 — Budgets, Goals, Profile/settings (biometric unlock)
5. Next.js dashboard, SMTP + Firebase (outbox), ingestion, insights/Ollama, SaaS, production hardening

## Blocked / needs the product owner
- **GitHub remote** — needed for CI (PostgreSQL 16 + Flutter jobs).
- **Android cmdline-tools** (Android Studio → SDK Manager → SDK Tools) to run on an emulator; macOS for iOS builds.
- SMTP credentials, Firebase project, Google OAuth client IDs, AA partner, Razorpay (later priorities).

## Production blockers (not production-ready)
CI on PostgreSQL 16 · RLS / encryption at rest · email and push delivery tests · device testing (Android, iOS) · backup/restore drill · monitoring · load testing · data export and account deletion · consent records · security review.
