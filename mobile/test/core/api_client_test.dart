import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/api/api_client.dart';
import 'package:pfm_mobile/core/api/api_error.dart';
import 'package:pfm_mobile/core/api/token_store.dart';

import 'fake_backend.dart';

void main() {
  late FakeBackend backend;
  late MemoryTokenStore store;
  late ApiClient client;
  late int expiredCalls;

  setUp(() {
    backend = FakeBackend();
    store = MemoryTokenStore(const TokenPair(accessToken: 'access-1', refreshToken: 'refresh-1'));
    expiredCalls = 0;
    client = ApiClient(baseUrl: 'http://test/api/v1', tokens: store, adapter: backend, onSessionExpired: () => expiredCalls++);
  });

  test('attaches the access token', () async {
    final res = await client.get<Map<String, dynamic>>('/accounts');
    expect(res['ok'], true);
    expect(backend.refreshCalls, 0);
  });

  test('refreshes once on 401 and retries the request', () async {
    backend.validAccess = 'access-already-rotated'; // stored token is now stale
    final res = await client.get<Map<String, dynamic>>('/accounts');
    expect(res['ok'], true);
    expect(backend.refreshCalls, 1);
    expect((await store.read())!.refreshToken, 'refresh-2');
    expect(backend.log, ['GET /accounts', 'POST /auth/refresh', 'GET /accounts']);
  });

  test('many concurrent 401s trigger a single refresh (single-flight)', () async {
    backend.validAccess = 'stale';
    final results = await Future.wait(List.generate(5, (i) => client.get<Map<String, dynamic>>('/r$i')));
    expect(results.every((r) => r['ok'] == true), isTrue);
    // Refresh tokens are single-use on the server: a second refresh would have been rejected.
    expect(backend.refreshCalls, 1);
    expect(expiredCalls, 0);
  });

  test('a rejected refresh clears tokens and reports the session as ended', () async {
    backend.validAccess = 'stale';
    backend.validRefresh = 'someone-else-rotated-it';
    await expectLater(client.get('/accounts'), throwsA(isA<ApiError>().having((e) => e.kind, 'kind', ApiErrorKind.unauthorized)));
    expect(await store.read(), isNull);
    expect(expiredCalls, 1);
  });

  test('retries at most once', () async {
    backend.responses['/always-401'] = (401, {'statusCode': 401, 'code': 'unauthorized', 'message': 'No.'});
    await expectLater(client.get('/always-401'), throwsA(isA<ApiError>().having((e) => e.kind, 'kind', ApiErrorKind.unauthorized)));
    // Original request + exactly one retry after a single refresh; no loop.
    expect(backend.log, ['GET /always-401', 'POST /auth/refresh', 'GET /always-401']);
  });

  test('offline during refresh keeps the session', () async {
    backend.validAccess = 'stale';
    final pending = client.get('/accounts');
    backend.offline = true;
    await expectLater(pending, throwsA(isA<ApiError>().having((e) => e.isOffline, 'isOffline', true)));
    expect(await store.read(), isNotNull);
    expect(expiredCalls, 0);
  });

  test('maps the backend error body into ApiError', () async {
    backend.responses['/accounts'] = (
      400,
      {
        'statusCode': 400,
        'code': 'validation_failed',
        'message': 'Some fields need attention.',
        'fields': {
          'name': ['Enter an account name.'],
          'type': ['Choose an account type.'],
        },
      },
    );
    try {
      await client.post('/accounts', body: {});
      fail('expected an error');
    } on ApiError catch (e) {
      expect(e.kind, ApiErrorKind.validation);
      expect(e.code, 'validation_failed');
      expect(e.fieldError('name'), 'Enter an account name.');
      expect(e.statusCode, 400);
    }
  });

  test('maps domain errors and 5xx', () async {
    backend.responses['/transactions'] = (
      422,
      {'statusCode': 422, 'code': 'before_tracking_start', 'message': 'This date is before you started tracking HDFC.'},
    );
    await expectLater(client.post('/transactions'), throwsA(isA<ApiError>().having((e) => e.code, 'code', 'before_tracking_start')));
    backend.responses['/boom'] = (500, {'statusCode': 500, 'code': 'internal_error', 'message': 'Something went wrong on our side. Please try again.'});
    await expectLater(client.get('/boom'), throwsA(isA<ApiError>().having((e) => e.kind, 'kind', ApiErrorKind.server)));
  });

  test('connection failures become offline errors', () async {
    backend.offline = true;
    await expectLater(client.get('/accounts'), throwsA(isA<ApiError>().having((e) => e.kind, 'kind', ApiErrorKind.offline)));
  });

  test('requests can be cancelled', () async {
    final token = CancelToken()..cancel();
    await expectLater(client.get('/accounts', cancelToken: token), throwsA(isA<ApiError>().having((e) => e.kind, 'kind', ApiErrorKind.cancelled)));
  });

  test('sends Idempotency-Key and unauthenticated calls carry no token', () async {
    final key = ApiClient.newIdempotencyKey();
    expect(key, matches(RegExp(r'^m-[0-9a-f-]{36}$')));
    final res = await client.post<Map<String, dynamic>>('/transactions', body: {}, idempotencyKey: key);
    expect(res['idempotencyKey'], key);
    await store.clear();
    backend.responses['/auth/login'] = (200, {'accessToken': 'a', 'refreshToken': 'r', 'accessTokenExpiresIn': 900});
    await client.post('/auth/login', body: {}, auth: false);
    expect(backend.refreshCalls, 0);
  });
}
