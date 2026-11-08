# API Contract — v1 (frozen 2026-11-08)

Base path: `/api/v1`. The machine-readable contract is [`docs/api/openapi-v1.json`](api/openapi-v1.json) (41 paths). The test `backend/test/api-contract.e2e-spec.ts` fails whenever the generated contract differs from the frozen file.

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

## Known gaps
- Response bodies are not yet described as OpenAPI schemas (request bodies are). Flutter models are written by hand against the documented responses and checked against the running API. Response schemas will be added module by module (KI-016).

## Change log

| Date | Change | Breaking? |
|---|---|---|
| 2026-11-08 | Initial freeze (review gate). Adds `historical`, `trackingStartDate`, `allocationMode`, settlement history, contribution reversal, `sort`, `Idempotency-Key` and the uniform error `code`. | Additive over the pre-gate API. Behaviour changes: new goals are track-only (D-015), old-dated manual transactions are rejected (D-019), warning starts at the lowest threshold (D-020). |
