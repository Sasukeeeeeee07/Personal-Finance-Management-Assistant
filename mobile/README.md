# Mobile app (Flutter)

Android first, iOS compatible. Riverpod, GoRouter, Material 3, Dio and flutter_secure_storage.

## Run

1. Start the backend (`cd backend && npm run dev`).
2. Run the app:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1
```

`10.0.2.2` is how the Android emulator reaches your computer. On iOS simulator, web or desktop, use `http://localhost:4000/api/v1`. Debug Android builds allow plain HTTP for this; release builds are HTTPS only.

## Test

```bash
flutter analyze
flutter test
flutter test test/integration --dart-define=LIVE_API_URL=http://localhost:4000/api/v1   # against a running backend
```

## Structure

```
lib/core/api/        ApiClient (single-flight refresh, retry once, timeouts, cancellation), ApiError, TokenStore
lib/core/money/      Money: exact decimals from API strings, Indian digit grouping. Never double.
lib/core/router/     GoRouter + auth redirect rule
lib/core/theme/      Design tokens (spacing, radii, finance colours), light and dark themes
lib/features/auth/   Sign in, register, forgot password, session restore, offline state
lib/features/profile Profile, email verification, sign out (this device / all devices)
lib/shared/          Form widgets (visible labels, validate on blur), banners
```

## Rules
- The backend is the source of truth for every financial number. The app displays what the API returns.
- Money values stay as decimal strings / `Money`. Never parse them into `double`.
- Every control calls the real API. No placeholder data or decorative buttons.
- Mutations that may be retried send an `Idempotency-Key` (`ApiClient.newIdempotencyKey()`).
