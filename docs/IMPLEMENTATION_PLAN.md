# Personal Finance Manager — Implementation Plan

Core philosophy: **Allocate first. Spend second.**

## 1. Repository layout

```
/backend   NestJS 11 + TypeScript, Kysely (typed SQL), PostgreSQL
/web       Next.js 15 (App Router) + TypeScript + Tailwind
/mobile    Flutter 3.35 + Riverpod + GoRouter + Material 3
/docs      Plan, progress, architecture decisions, API notes
docker-compose.yml   Postgres 16 + Redis 7 for local/prod-like runs
.github/workflows    CI (backend tests, web build, flutter analyze/test)
```

## 2. Key architecture decisions

| Decision | Choice | Why |
|---|---|---|
| DB access | Kysely + hand-written SQL migrations | Typed queries, explicit SQL for financial logic, no ORM magic around money. |
| Local DB without Docker | PGlite (Postgres compiled to WASM) when `DATABASE_URL` is unset | The dev machine has no Docker/Postgres. PGlite is real Postgres, so migrations and SQL are identical. Production always uses `DATABASE_URL`. |
| Money | `NUMERIC(19,2)` in DB, `decimal.js` in app, strings over the API | Never floating point. Amounts are serialised as strings (`"8000.00"`). |
| Currency | `currency CHAR(3)` on accounts and transactions, default `INR` | Extensible; cross-currency aggregation is out of scope until FX is added. |
| Balances | Derived from an append-only **ledger** (`ledger_entries`) | Auditable. A balance is `opening_balance + SUM(ledger_entries.amount)`. |
| Transfers | One `transactions` row of type `transfer` → two ledger entries (−source, +destination) | Never counted as income or expense. |
| Credit cards | Card is a liability account. Purchase = `expense` on the card (balance goes negative = amount owed). Bill payment = `transfer` bank → card. | The bill payment settles the liability, it is not a second expense. |
| Reservations | Virtual allocations in `money_reservations`; never touch the ledger | "Reserved" reduces *available-to-spend*, not the bank balance. The app never claims money is frozen at the bank. |
| Reconciliation | Paying a reserved bill links the expense to the reservation and closes it in one DB transaction | The expense lowers the balance and the reservation is released at the same moment → no double deduction. |
| Dedup | `(owner, account, external_reference)` exact match → `duplicate`; fuzzy match (same account, type, amount, ±10 min, different source) → `needs_review` | Only `confirmed` transactions create ledger entries. |
| Tenant isolation | Every financial table has `owner_id` and `organization_id`; repositories always filter by the authenticated owner | Admins never gain implicit access to personal transactions. RLS planned as defence in depth (Phase 8). |
| RBAC | `roles`, `permissions`, `role_permissions`; org membership carries a role; users can carry a platform role | New permissions are data, not code changes. Guards check permission keys. |
| Auth | Argon2id passwords, 15-min JWT access tokens, opaque refresh tokens stored hashed, rotation with reuse detection (family revocation) | Standard, secure session handling. |
| Jobs | BullMQ + Redis (Phase 5) | Reminders, recurring generation, monthly reports. |

### Available-to-spend

```
liquid balance   = Σ balances of accounts where is_liquid (savings, current, cash, UPI bank, wallet)
reserved         = Σ active reservation amounts
allocated        = Σ funds earmarked for goals (Phase 3, goal allocations)
available        = liquid balance − reserved − allocated
```

Fixed deposits are not liquid. Credit card dues are shown as a separate liability figure and are **not** subtracted automatically (the user creates a commitment for the card bill, which reserves it) — this avoids subtracting the same dues twice.

## 3. Transaction ingestion (Phase 5) — adapter architecture

`TransactionSourceAdapter` → normalised `IncomingTransaction` → dedup → categorisation → status (`confirmed` / `needs_review` / `duplicate` / `ignored`).

| Source | Android | iOS | Notes |
|---|---|---|---|
| Manual entry | ✅ | ✅ | Always available |
| Statement import (CSV/XLSX/PDF) | ✅ | ✅ | Server-side parsers |
| Account Aggregator | ✅ | ✅ | Only through a regulated AA/FIU partner (e.g. Setu, Finvu, OneMoney). The app is **not** an AA. |
| SMS parsing | ✅ (with READ_SMS consent; Play policy restrictions apply) | ❌ (iOS does not allow it) | |
| Notification listener | ✅ (explicit consent, payment-app notifications only) | ❌ | |

Never: unofficial Google Pay APIs, screen scraping, UPI PINs, OTPs, card CVVs, bank passwords, automated payments.

## 4. Execution order (approved 2026-11-08)

| Priority | Scope | Status |
|---|---|---|
| 1 | Phase 3: budgets, goals, forecast, test #11 | ✅ Done (HANDOFF-002) |
| 2 | Real PostgreSQL validation in CI | ⚠️ Passed locally on PG 17.11; CI (PG 16) waits for a Git remote |
| 3 | Flutter MVP (Android first, iOS compatible) | Next |
| 4 | Next.js dashboard | |
| 5 | SMTP email + Firebase notifications (BullMQ + Redis) | |
| 6 | Transaction automation (adapters, statement import, Android SMS/notifications) | |
| 7 | Deterministic insights, discipline score, optional Ollama coach | |
| 8 | SaaS plans, billing abstraction, Super Admin, production hardening | |

### Priority 3 plan — Flutter MVP
- `mobile/` Flutter app: Riverpod, GoRouter, Material 3, light/dark, `flutter_secure_storage` for tokens.
- One typed API client (Dio) with automatic refresh-token rotation and a single-flight refresh lock; amounts kept as strings / Decimal, never `double`.
- Bottom navigation: Home · Transactions · Budget · Goals · Profile; quick-add FAB.
- Screens bound to existing endpoints only; every screen has loading, empty, error and offline states.
- Tests: unit (API client, refresh logic), widget (forms, states), navigation; an integration test against a locally running backend.
- Android-specific code (SMS, notification listener) is kept out of shared code (Priority 6).

Each priority ends with tests run, docs updated and an AI_HANDOFF entry.
