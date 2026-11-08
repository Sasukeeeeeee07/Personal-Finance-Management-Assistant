# API Contract — v1 (frozen 2026-11-08)

Base path: `/api/v1`. The machine-readable contract is [`docs/api/openapi-v1.json`](api/openapi-v1.json) (41 paths, 44 schemas). The test `backend/test/api-contract.e2e-spec.ts` fails whenever the generated contract differs from the frozen file.

To change the API on purpose:
1. Make the change.
2. Run `npm run openapi:freeze`.
3. Add an entry to the change log below.

Breaking changes need a new version or reviewer approval.

## Conventions

| Topic | Rule |
|---|---|
| Money | Responses use decimal strings with exactly 2 decimals (`"8000.00"`); requests accept up to 2 decimals. Never floats. Clients must not parse money into binary floating point. |
| Dates | Date-only fields are `YYYY-MM-DD` in India time. Timestamps are ISO 8601 UTC (`2026-11-08T04:30:00.000Z`); requests accept any ISO 8601 offset. |
| Errors | `{ statusCode, code, message, fields?, details? }`. `code` is stable and machine-readable (`validation_failed`, `before_tracking_start`, `reservation_amount_mismatch`, …). On 400 validation errors, `fields` maps each field to its messages. A 500 never includes internals. |
| Auth | `Authorization: Bearer <access token>` (15 minutes). Refresh tokens are single-use; reusing one revokes the whole session chain. |
| Ownership | Every resource is scoped to the caller. Another user's resource returns 404, never 403. |
| Pagination | `GET /transactions?page=&pageSize=` (max 200) returns `{ items, page, pageSize, total, sort }`. Other lists are bounded per user and unpaginated in v1. |
| Sorting | `GET /transactions?sort=` accepts `occurredAt:desc` (default), `occurredAt:asc`, `amount:desc` or `amount:asc`. Ties are broken by creation time, then id, so pages never overlap. |
| Idempotency | `Idempotency-Key` header on `POST /transactions` and `POST /goals/:id/contributions` (D-017). |
| Versioning | Versioned by URL (`/api/v1`). Additive fields may appear within v1; clients must ignore unknown fields. |

## Response schemas
Documented, and enforced by `backend/test/response-contract.e2e-spec.ts`, for every endpoint the Flutter dashboard consumes:

| Endpoint | Schema |
|---|---|
| `GET /auth/me` | `MeResponse` |
| `GET /accounts`, `GET /accounts/{id}` | `AccountResponse` |
| `GET /categories` | `CategoryResponse` |
| `GET /budgets`, `GET /budgets/{id}` | `BudgetResponse` (+ `BudgetCurrentResponse`) |
| `GET /dashboard/summary` | `DashboardSummaryResponse` |
| `GET /forecast/month-end` | `ForecastResponse` |
| `GET /transactions` | `TransactionListResponse` |
| `GET /transactions/{id}` | `TransactionDetailResponse` |

The contract test validates real responses, for both a populated and an empty account, against the **frozen** file. Every documented field must be present and no undocumented field is allowed. Money fields carry the pattern `^-?\d{1,17}\.\d{2}$`, dates `^\d{4}-\d{2}-\d{2}$`, and timestamps `format: date-time`.

## Known gaps
- Response schemas for the remaining endpoints (reservations, commitments, goals, write endpoints) will be added as their Flutter modules start (KI-016).

## Change log

| Date | Change | Breaking? |
|---|---|---|
| 2026-11-08 | Flutter step 2: response schemas for the 10 dashboard endpoints; new fields `netPosition` (dashboard summary), `availableNow` and `availableChangeByMonthEnd` (forecast). | No — additive. |
| 2026-11-08 | Initial freeze (review gate). Adds `historical`, `trackingStartDate`, `allocationMode`, settlement history, contribution reversal, `sort`, `Idempotency-Key` and the uniform error `code`. | Additive over the pre-gate API. Behaviour changes: new goals are track-only (D-015), old-dated manual transactions are rejected (D-019), warning starts at the lowest threshold (D-020). |
