# Known Issues and Limitations

Severity: **High** (wrong numbers or security exposure possible), **Medium** (incorrect in edge cases or a missing safeguard), **Low** (cosmetic, performance, or by design but worth revisiting).

## Open

| ID | Severity | Area | Issue | Plan |
|---|---|---|---|---|
| KI-001 | Low | Validation | CI is green on `main` (incl. PostgreSQL 16), but `feature/mvp-completion` has not been pushed, so its CI run is NOT VERIFIED. Local real-Postgres runs use 17.11. | Push the branch and check the run before merging. |
| KI-002 | Low | Email | SMTP delivery implemented (nodemailer, 2 background retries, masked logs) but **not verified against a real SMTP server**. No durable queue: a message is lost if the instance restarts mid-retry. Without SMTP settings, reset/verify emails are not sent. | Configure SMTP and send a test reset; a queue is not needed for personal use. |
| KI-003 | Medium | Auth | Google Sign-In untested with real Google tokens; not wired in the Flutter app yet. | Needs OAuth client IDs. |
| KI-004 | Medium | Security | No Postgres row-level security; isolation relies on owner filtering (covered by tests). | Evaluated in D-022; Priority 8 behind a flag. |
| KI-016 | Low | API contract | Response schemas cover the dashboard endpoints plus reports, commitments, reservations and goals (enforced by the response contract test). Write-endpoint responses (POST/PATCH bodies) and budgets/accounts detail are still not schema-tested. | Add when those screens next change. |
| KI-017 | Low | Mobile | Not run on an Android emulator/device or iOS. The deployment target is the web app, verified in Chrome. | Optional: install Android cmdline-tools. |
| KI-018 | Medium | Mobile | No biometric unlock yet (optional in spec). | Add with `local_auth` in the profile/settings module. |
| KI-021 | Low | Tooling | Incremental `flutter build apk` fails on this machine because the project path contains spaces (`Failed to create parent directory 'C:\Users\win'`); a clean build (`flutter clean`) succeeds. CI paths have no spaces. | Move the project to a path without spaces, or keep using clean builds locally. |
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
| KI-024 | Medium | Mobile | No offline entry queue: adding a transaction while offline fails with a clear message and nothing is saved locally. Nothing pending ever affects balances (there is no pending state on the client). | Persist unsent requests with their idempotency keys and replay on reconnect. |
| KI-025 | Medium | Profile | No way to change your name or password while signed in (no API endpoint, no screen). Password change today = "forgot password", which needs SMTP. | `PATCH /auth/me`, `POST /auth/change-password` (revoke other sessions) + Profile screens. |
| KI-026 | Low | Hosting | Render free instances sleep after ~15 min idle; the first request then waits ~30–60 s. The web build uses `API_TIMEOUT_SECONDS=75` so it doesn't fail. | Accept for personal use (₹0). |
| KI-027 | Low | Web | GoRouter `push` navigations (details, forms) don't change the browser address bar, so refreshing on a detail page returns to the list it was opened from. Tab pages and deep links work. | Consider `GoRouter.optionURLReflectsImperativeAPIs` after checking back-button behaviour. |
| KI-028 | Low | Web | No Content-Security-Policy header on Vercel (Flutter's CanvasKit loader needs wasm and gstatic). Other security headers are set. | Add a tested CSP later. |
| KI-029 | Low | Repo | `neon.ts`, a root `package.json` and root `package-lock.json` (from the Neon CLI's `neon init`) were committed in 51c2bb6. They contain no secrets and aren't used by the app. | Owner to keep or remove. |

## Resolved in the review gate (2026-11-08)

| ID | Resolution |
|---|---|
| KI-005 | Deleting a payment no longer leaves two open reservations for one obligation (D-018, tests B1). |
| KI-011 | Manual transactions before the account's tracking start date are rejected; historical imports are explicit (D-019). |
| KI-006 (asOf) | Past `asOf` now uses the balance as of that date; future `asOf` is rejected (D-016). |
| — | Offline sign-out no longer waits ~10 s for a network timeout (found in browser walkthrough). |
| — | Migrations now refuse to run on a non-UTF-8 database (found on real PostgreSQL). |
| KI-023 | **Resolved 2026-11-08 (tests only).** Two forecast tests pinned `asOf=2026-11-08` but their commitments and reservations got `created_at = now()` from the database, which historical forecasts compare with `asOf`; from 9 Nov they would have dropped out. All their dates are now derived from one `AS_OF` constant, and a test helper (`setCommitmentsCreatedAt`) places the commitments and reservations on the morning of `AS_OF`. Assertions unchanged; one assertion added proving a commitment created after `asOf` is excluded. Forecast logic not changed. |
