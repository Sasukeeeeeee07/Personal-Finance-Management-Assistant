import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/api/api_client.dart';
import 'package:pfm_mobile/core/api/token_store.dart';
import 'package:pfm_mobile/core/providers.dart';
import 'package:pfm_mobile/features/auth/state/auth_controller.dart';
import 'package:pfm_mobile/main.dart';

import '../core/fake_backend.dart';
import 'fixtures.dart';

const signedInTokens = TokenPair(accessToken: 'access-1', refreshToken: 'refresh-1');

/// Boots the real app (router, theme, providers) against an in-memory fake backend.
Future<(FakeBackend, MemoryTokenStore)> pumpApp(WidgetTester tester, {TokenPair? stored, bool emptyDashboard = false, FakeBackend? backend}) async {
  final api = backend ?? FakeBackend();
  api.responses.putIfAbsent('/auth/me', () => (200, fixtureMap('me.json')));
  // A caller-supplied backend keeps its own responses (e.g. a failing endpoint under test).
  if (backend == null) serveDashboard(api, empty: emptyDashboard);
  final store = MemoryTokenStore(stored);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        tokenStoreProvider.overrideWithValue(store),
        apiClientProvider.overrideWith((ref) {
          final c = ApiClient(baseUrl: 'http://test/api/v1', tokens: store, adapter: api);
          c.onSessionExpired = () => ref.read(authControllerProvider.notifier).sessionExpired();
          return c;
        }),
      ],
      child: const PfmApp(),
    ),
  );
  await tester.pumpAndSettle();
  return (api, store);
}

Future<void> openProfile(WidgetTester tester) async {
  await tester.tap(find.text('Profile').last);
  await tester.pumpAndSettle();
}
