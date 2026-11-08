// API integration test against a running backend. Skipped unless LIVE_API_URL is given:
//   flutter test test/integration --dart-define=LIVE_API_URL=http://localhost:4000/api/v1
@Tags(['live'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/api/api_client.dart';
import 'package:pfm_mobile/core/api/api_error.dart';
import 'package:pfm_mobile/core/api/token_store.dart';
import 'package:pfm_mobile/core/money/money.dart';
import 'package:pfm_mobile/features/auth/data/auth_api.dart';

const liveUrl = String.fromEnvironment('LIVE_API_URL');

void main() {
  final skip = liveUrl.isEmpty ? 'Set --dart-define=LIVE_API_URL to run against a live backend' : null;

  test('register → me → rotate tokens → reuse is rejected → logout', () async {
    final store = MemoryTokenStore();
    var expired = 0;
    final client = ApiClient(baseUrl: liveUrl, tokens: store, onSessionExpired: () => expired++);
    final auth = AuthApi(client);
    final email = 'flutter-${DateTime.now().microsecondsSinceEpoch}@example.com';

    final tokens = await auth.register(fullName: 'Flutter Test', email: email, password: 'sturdy-password-1');
    await store.write(tokens);
    final me = await auth.me();
    expect(me.email, email);
    expect(me.emailVerified, isFalse);
    expect(me.permissions, contains('finance.own.read'));

    // Force a refresh by invalidating the access token locally: the client must rotate and retry.
    await store.write(TokenPair(accessToken: 'not-a-valid-jwt', refreshToken: tokens.refreshToken));
    expect((await auth.me()).id, me.id);
    final rotated = (await store.read())!;
    expect(rotated.refreshToken, isNot(tokens.refreshToken));

    // Replaying the old refresh token is theft detection on the server: the session chain ends.
    await store.write(TokenPair(accessToken: 'not-a-valid-jwt', refreshToken: tokens.refreshToken));
    await expectLater(auth.me(), throwsA(isA<ApiError>().having((e) => e.kind, 'kind', ApiErrorKind.unauthorized)));
    expect(expired, 1);
    expect(await store.read(), isNull);
  }, skip: skip);

  test('backend money values are exact decimal strings', () async {
    final store = MemoryTokenStore();
    final client = ApiClient(baseUrl: liveUrl, tokens: store);
    final auth = AuthApi(client);
    await store.write(await auth.register(fullName: 'Money Test', email: 'money-${DateTime.now().microsecondsSinceEpoch}@example.com', password: 'sturdy-password-1'));
    final summary = await client.get<Map<String, dynamic>>('/dashboard/summary');
    for (final key in ['totalBalance', 'reserved', 'availableToSpend', 'creditCardOutstanding']) {
      expect(summary[key], isA<String>());
      expect(Money.fromApi(summary[key] as String).isZero, isTrue);
    }
    Object? err;
    try {
      await client.post<dynamic>('/accounts', body: {'name': '', 'type': 'nope'});
    } on ApiError catch (e) {
      err = e;
    }
    expect(err, isA<ApiError>().having((e) => e.code, 'code', 'validation_failed').having((e) => e.fieldError('type'), 'type error', isNotNull));
    await auth.logout();
  }, skip: skip);
}
