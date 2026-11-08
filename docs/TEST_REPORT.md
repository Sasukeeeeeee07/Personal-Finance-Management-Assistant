# Test Report

Only runs that were actually executed are recorded here.

## Latest run — 2026-11-08 (Flutter step 2: Dashboard)

| Environment | Command | Result |
|---|---|---|
| Backend · PGlite | `npm test` | **113 / 113 passed** |
| Backend · real PostgreSQL 17.11 (UTF-8, local) | `TEST_DATABASE_URL=… npm test` | **113 / 113 passed** |
| Mobile · `flutter analyze` | | No issues |
| Mobile · `flutter test` | | **38 passed**, 3 skipped (live tests need a backend URL) |
| Mobile · live API integration against the running backend | `flutter test test/integration --dart-define=LIVE_API_URL=http://localhost:4000/api/v1` | **3 / 3 passed** |
| Mobile · web release build + walkthrough at 375×812 and 1280×860, light and dark | `flutter build web --release` | Screenshots `docs/screenshots/11–23` |
| Mobile · Android debug APK (clean build) | `flutter clean && flutter build apk --debug` | **Succeeded** — 150.7 MB `app-debug.apk` |
| Android emulator run | — | **Not run** (cmdline-tools missing, KI-017) |
| GitHub Actions | — | **Not run** (no remote, KI-001) |

### New backend tests (+9)
`test/response-contract.e2e-spec.ts` — every dashboard endpoint has a documented 200 schema; real responses for a populated account and a brand-new account validate against the **frozen** contract (no undocumented fields, money/date patterns, required fields); `netPosition` value check; `availableNow` equals the dashboard's `availableToSpend`; the 10 Flutter fixture files validate; a negative test proves the validator rejects money-as-number, wrong decimals, extra fields and missing fields.

### New mobile tests (+14)
| Suite | Tests | Covers |
|---|---|---|
| `test/features/dashboard_models_test.dart` | 5 | Parsing real fixtures exactly (decimal strings preserved), empty-account nulls, all endpoint models, **forecast breakdown terms add up to the backend estimate**, money-as-number and malformed strings rejected |
| `test/features/dashboard_test.dart` | 9 | All five sections render backend figures; dashboard sends only GETs; calculation explanation sheet; empty states; one failing section isolated and retryable; offline refresh keeps last figures with notices; Refresh button reloads every section; recent transaction → detail; dark theme + wide layout (navigation rail, two columns); tap-target, labelled tap-target and **text-contrast** accessibility guidelines |
| `test/integration/live_api_test.dart` | +1 live | Every dashboard endpoint parsed into typed models from the live backend; available-to-spend equals the backend value |
| `test/features/auth_flow_test.dart` | 9 (updated) | Sign-in now lands on the dashboard; profile reached via the bottom bar; redirect rule covers the detail route |

### Defects found in this step
1. **Forecast breakdown did not add up** (missing "recurring expenses" line) — found by checking the screenshot against backend figures; fixed; regression test added.
2. **Pull-to-refresh unavailable with a mouse/keyboard on web/desktop** — found in the browser walkthrough; Refresh button added; test added.

## Previous run — 2026-11-08 (review gate + Flutter foundation)

| Environment | Command | Result |
|---|---|---|
| Backend · PGlite (in-memory), Node 20.14, Windows 10 | `npm test` | **104 / 104 passed** |
| Backend · real PostgreSQL **17.11**, UTF-8 (local, `embedded-postgres`) | `TEST_DATABASE_URL=… npm test` | **104 / 104 passed**, 3 consecutive runs |
| Backend · real PostgreSQL 17.11 | `migrate` → 5× `migrate -- --down` (008→004) → `migrate` | All 8 migrations applied, rolled back and re-applied |
| Mobile · `flutter analyze` | | No issues |
| Mobile · `flutter test` | | **24 passed**, 2 skipped (live tests need a backend URL) |
| Mobile · live API integration against the running backend | `flutter test test/integration --dart-define=LIVE_API_URL=http://localhost:4000/api/v1` | **2 / 2 passed** |
| Mobile · web release build + manual walkthrough in a browser (375×812) | `flutter build web --release` | Screens in `docs/screenshots/` |
| Mobile · Android debug APK | `flutter build apk --debug` | See "Android build" below |
| GitHub Actions (PostgreSQL 16, Flutter) | `.github/workflows/ci.yml` | **Not run** — the repository has no remote yet |

PostgreSQL 16 compatibility is still **not claimed**; it will be once the CI job passes.

### Issue found only on real PostgreSQL
The first real-Postgres run of migrations 005–008 failed because the Windows cluster had been initialised with a non-UTF-8 encoding and a migration comment contains a non-ASCII character. Fixes: the migrator now refuses to run unless `server_encoding = UTF8` (clear error message), and the local validation cluster is created with `--encoding=UTF8`. PGlite is always UTF-8, so it could not catch this.

## Backend suites (104)

| Suite | Tests | Covers |
|---|---|---|
| `test/review-gate.e2e-spec.ts` | 24 | **B1** reservation lifecycle (reversal restores pre-payment state, later paid occurrence kept, unconfirm/retype reversal, amount sync, DB uniqueness, concurrent reversal + successor payment, concurrent deletes, failure rollback with injected fault); **B2** goals (track-only default, opt-in reserve, linked transfer counted once, non-liquid account not double-deducted, reversals, idempotent contributions); **B3** health vs events; **B4** tracking start + historical imports; **B5** forecast as-of, 50/30/20 weighting, no double counting; **E** error shape, sorting/pagination, idempotency (incl. concurrent), decimal/ISO formats |
| `test/finance.e2e-spec.ts` | 17 | Critical cases 1–10 and core rules |
| `test/budgets-goals.e2e-spec.ts` | 20 | Budgets, goals, forecast v1 scenario, concurrency, rollback |
| `test/auth-rbac.e2e-spec.ts` | 11 | Auth, sessions, RBAC, case 12 |
| `test/migrations.e2e-spec.ts` | 4 | Idempotent migrations, rollback of 004–008, **upgrade of pre-review data (004 → 008 backfills)**, DB constraints |
| `test/api-contract.e2e-spec.ts` | 2 | Generated OpenAPI equals frozen `docs/api/openapi-v1.json`; all routes under `/api/v1` |
| `src/budgets/budget-period.spec.ts` | 9 | Periods, reset day, rollover, health threshold |
| `src/forecast/variable-spending.spec.ts` | 6 | Weighted windows, redistribution, fallback |
| `src/goals/goals.spec.ts` | 4 | Goal projections |
| `src/common/dates.spec.ts` | 3 | Date arithmetic |
| `src/transactions/ledger.service.spec.ts` | 4 | Ledger entry rules |

### Tests changed to match approved rule changes (not weakened)
| Test | Change | Reason |
|---|---|---|
| budgets › food budget… | health `on_track` → `warning` at 62.5% | D-020: warning starts at lowest threshold (50%) |
| budget-period › food budget… | same | D-020 |
| goals › three allocation tests | create goals with `allocationMode: 'reserve'` | D-015: new goals default to track-only |
| budgets / forecast / expense-insight setups | accounts created with `trackingStartDate: '2026-01-01'` | D-019: back-dated manual transactions are now rejected |
| migrations › rollback | rolls back 008→004 instead of 004 only | four new migrations |

## Mobile suites (24 + 2 live)

| Suite | Tests | Covers |
|---|---|---|
| `test/core/api_client_test.dart` | 11 | Token attach; refresh + retry; **5 concurrent 401s → 1 refresh**; rejected refresh clears session; retry at most once; offline during refresh keeps session; error body → `ApiError` (validation fields, domain codes, 5xx); offline; cancellation; Idempotency-Key; unauthenticated calls |
| `test/core/money_test.dart` | 4 | Exact parsing (0.10 + 0.20 = 0.30), rejects malformed amounts, Indian grouping, input parsing |
| `test/features/auth_flow_test.dart` | 9 | Redirect rule; signed-out launch; validation then sign-in → profile; wrong-password message; register maps server field error; session restore + sign-out; **sign-out under a 30 s network delay completes immediately**; all-devices sign-out offline reports failure and keeps session; offline launch → offline screen → retry |
| `test/integration/live_api_test.dart` | 2 (live) | Against the real backend: register → me → forced refresh rotation → **old refresh token rejected, session ended**; dashboard money strings parse exactly; validation error shape |

### Bug found during the browser walkthrough
Signing out while offline waited about 10 s (connection timeout) because sign-out awaited the server logout call. Fixed: this-device sign-out clears local tokens immediately and revokes the server session in the background; all-devices sign-out still waits and reports failure. Covered by two new widget tests.

## Critical financial scenarios
All 12 remain covered (see the previous mapping); scenario 5 now also covers reversal of a reserved payment (review-gate B1), scenario 6/10 cover historical imports and idempotent replays.

## Android build
See the result recorded at the end of HANDOFF-003 in `AI_HANDOFF.md`.

## Not yet tested
Flutter on a physical device or emulator, iOS build, push notifications, email delivery, load testing, backup/restore drill.
