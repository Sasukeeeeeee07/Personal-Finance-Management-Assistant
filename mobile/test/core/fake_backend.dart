import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// In-memory stand-in for the backend's auth behaviour: access tokens expire, refresh tokens are
/// single-use and rotate, and reusing an old refresh token is rejected.
class FakeBackend implements HttpClientAdapter {
  FakeBackend({this.validAccess = 'access-1', this.validRefresh = 'refresh-1'});

  String validAccess;
  String validRefresh;
  int refreshCalls = 0;
  int generation = 1;
  final List<String> log = [];
  bool offline = false;
  Duration refreshDelay = const Duration(milliseconds: 20);

  /// Simulated network latency for every request (e.g. a very slow connection).
  Duration latency = Duration.zero;

  /// Optional per-path override returning (status, body).
  final Map<String, (int, Object?)> responses = {};

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final path = options.path;
    log.add('${options.method} $path');
    if (latency > Duration.zero) await Future<void>.delayed(latency);
    if (offline) throw DioException.connectionError(requestOptions: options, reason: 'offline');

    if (path == '/auth/refresh') {
      refreshCalls++;
      await Future<void>.delayed(refreshDelay);
      final body = await _body(requestStream);
      if (body['refreshToken'] != validRefresh) return _json(401, {'statusCode': 401, 'code': 'unauthorized', 'message': 'Your session has ended. Sign in again.'});
      generation++;
      validAccess = 'access-$generation';
      validRefresh = 'refresh-$generation';
      return _json(200, {'accessToken': validAccess, 'refreshToken': validRefresh, 'accessTokenExpiresIn': 900});
    }
    if (responses.containsKey(path)) {
      final (status, body) = responses[path]!;
      return _json(status, body);
    }
    if (options.extra['auth'] != false && options.headers['Authorization'] != 'Bearer $validAccess') {
      return _json(401, {'statusCode': 401, 'code': 'unauthorized', 'message': 'Your session has expired. Sign in again.'});
    }
    return _json(200, {'ok': true, 'path': path, 'idempotencyKey': options.headers['Idempotency-Key']});
  }

  Future<Map<String, dynamic>> _body(Stream<Uint8List>? stream) async {
    if (stream == null) return {};
    final bytes = await stream.fold<List<int>>([], (a, b) => a..addAll(b));
    return jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>;
  }

  ResponseBody _json(int status, Object? body) =>
      ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});

  @override
  void close({bool force = false}) {}
}
