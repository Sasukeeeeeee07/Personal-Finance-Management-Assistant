# Known Issues and Limitations

Severity: **High** (wrong numbers or security exposure possible), **Medium** (incorrect in edge cases or a missing safeguard), **Low** (cosmetic, performance, or by design but worth revisiting).

## Open

| ID | Severity | Area | Issue | Plan |
|---|---|---|---|---|
| KI-001 | Medium | Validation | GitHub remote now exists and CI is configured, but no GitHub Actions run has completed yet. Real Postgres is validated on 17.11 locally only. | Push the `ci/github-actions` branch and check the run. |
| KI-002 | Medium | Email | Mailer only logs messages; no delivery, retry or queue. | Priority 5 (SMTP + BullMQ, outbox D-021). |
| KI-003 | Medium | Auth | Google Sign-In untested with real Google tokens; not wired in the Flutter app yet. | Needs OAuth client IDs. |
| KI-004 | Medium | Security | No Postgres row-level security; isolation relies on owner filtering (covered by tests). | Evaluated in D-022; Priority 8 behind a flag. |
| KI-016 | Low | API contract | Response schemas exist for the 10 dashboard endpoints (enforced by tests); reservations, commitments, goals and write endpoints are still undocumented. | Add with each Flutter module. |
| KI-017 | Medium | Mobile | Not yet run on an Android emulator/device or iOS; validated on Flutter web and with widget/integration tests. | Run on emulator once Android cmdline-tools are installed; iOS needs macOS. |
| KI-018 | Medium | Mobile | No biometric unlock yet (optional in spec). | Add with `local_auth` in the profile/settings module. |
| KI-021 | Low | Tooling | Incremental `flutter build apk` fails on this machine because the project path contains spaces (`Failed to create parent directory 'C:\Users\win'`); a clean build (`flutter clean`) succeeds. CI paths have no spaces. | Move the project to a path without spaces, or keep using clean builds locally. |
| KI-023 | Medium | Tests | `budgets-goals.e2e-spec.ts` (forecast scenario) and `review-gate.e2e-spec.ts` (no double counting) pin `asOf=2026-11-08` but create commitments at the current time; after 2026-11-08 those commitments postdate `asOf` and the tests will fail in CI. No production logic is affected. | Use dates relative to today or an injectable clock in tests. |
| KI-022 | Low | Mobile | Dashboard figures are kept in memory only; after a cold start while offline the app shows the offline screen instead of last-known figures. | Decide whether to persist an encrypted snapshot (HANDOFF-004 question 4). |
| KI-006 | Low | Forecast | Historical forecasts are rebuilt from current records: reservations cancelled by a later payment reversal are approximated by `closed_at`. | Acceptable for v1; documented in the response assumptions. |
| KI-007 | Low | Forecast | Expected recurring income/expenses rely on transactions marked recurring; no recurring schedules yet. | Recurring schedules (Phase 3 backlog). |
| KI-008 | Low | Budgets | Alerts are evaluated for the current period only. | By design. |
| KI-009 | Low | Budgets | Alerts are evaluated after commit, not via a queue. Idempotent, so a missed evaluation catches up on the next write. | Outbox in Priority 5. |
| KI-010 | Low | Performance | Each transaction write re-evaluates all of the user's budgets. | Profile before optimising. |
| KI-012 | Low | Time zones | Boundaries use Asia/Kolkata. | Per-user time zone. |
| KI-013 | Low | Currency | Totals assume one currency (INR). | FX before multi-currency launch. |
| KI-014 | Low | Privacy | Audit rows keep full snapshots; no retention policy. Idempotency keys are kept indefinitely. | Retention policy under DPDP; purge job for idempotency keys (e.g. 30 days). |
| KI-015 | Low | Tooling | Jest needs `--experimental-vm-modules` for PGlite. | Baked into `npm test`. |
| KI-019 | Low | Accounts | `tracking_start_date` cannot be changed after creation. | Re-basing flow (new opening balance at the new date) if users need it. |
| KI-020 | Low | Forecast | Recurring-vs-commitment de-duplication matches on category or exact name; a differently named commitment for the same bill could still double-count. | Link transactions to commitments explicitly when ingestion lands. |

## Resolved in the review gate (2026-11-08)

| ID | Resolution |
|---|---|
| KI-005 | Deleting a payment no longer leaves two open reservations for one obligation (D-018, tests B1). |
| KI-011 | Manual transactions before the account's tracking start date are rejected; historical imports are explicit (D-019). |
| KI-006 (asOf) | Past `asOf` now uses the balance as of that date; future `asOf` is rejected (D-016). |
| — | Offline sign-out no longer waits ~10 s for a network timeout (found in browser walkthrough). |
| — | Migrations now refuse to run on a non-UTF-8 database (found on real PostgreSQL). |
