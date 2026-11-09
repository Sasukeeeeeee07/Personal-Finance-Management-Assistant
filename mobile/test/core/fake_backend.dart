import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// A request the fake backend received.
class RecordedRequest {
  RecordedRequest(this.method, this.path, this.query, this.body, this.headers);

  final String method;
  final String path;
  final Map<String, dynamic> query;
  final Object? body;
  final Map<String, dynamic> headers;
}

/// In-memory stand-in for the backend's auth behaviour: access tokens expire, refresh tokens are
/// single-use and rotate, and reusing an old refresh token is rejected.
class FakeBackend implements HttpClientAdapter {
  FakeBackend({this.validAccess = 'access-1', this.validRefresh = 'refresh-1'});

  String validAccess;
  String validRefresh;
  int refreshCalls = 0;
  int generation = 1;
  final List<String> log = [];
  final List<RecordedRequest> requests = [];
  bool offline = false;
  Duration refreshDelay = const Duration(milliseconds: 20);

  /// Simulated network latency for every request (e.g. a very slow connection).
  Duration latency = Duration.zero;

  /// Overrides returning (status, body). Keys are either 'METHOD /path' (checked first) or '/path'.
  final Map<String, (int, Object?)> responses = {};

  /// Responses consumed in order for 'METHOD /path' (e.g. a 409 first, then a 201 on retry).
  final Map<String, List<(int, Object?)>> queued = {};

  List<RecordedRequest> sent(String method, String path) => requests.where((r) => r.method == method && r.path == path).toList();

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final path = options.path;
    final method = options.method;
    log.add('$method $path');
    final body = await _read(requestStream);
    requests.add(RecordedRequest(method, path, Map.of(options.queryParameters), body, Map.of(options.headers)));
    if (latency > Duration.zero) await Future<void>.delayed(latency);
    if (offline) throw DioException.connectionError(requestOptions: options, reason: 'offline');

    if (path == '/auth/refresh') {
      refreshCalls++;
      await Future<void>.delayed(refreshDelay);
      if ((body as Map?)?['refreshToken'] != validRefresh) {
        return _json(401, {'statusCode': 401, 'code': 'unauthorized', 'message': 'Your session has ended. Sign in again.'});
      }
      generation++;
      validAccess = 'access-$generation';
      validRefresh = 'refresh-$generation';
      return _json(200, {'accessToken': validAccess, 'refreshToken': validRefresh, 'accessTokenExpiresIn': 900});
    }
    final queue = queued['$method $path'];
    if (queue != null && queue.isNotEmpty) {
      final (status, b) = queue.removeAt(0);
      return _json(status, b);
    }
    final override = responses['$method $path'] ?? responses[path];
    if (override != null) {
      final (status, b) = override;
      return _json(status, b);
    }
    if (options.extra['auth'] != false && options.headers['Authorization'] != 'Bearer $validAccess') {
      return _json(401, {'statusCode': 401, 'code': 'unauthorized', 'message': 'Your session has expired. Sign in again.'});
    }
    return _json(200, {'ok': true, 'path': path, 'idempotencyKey': options.headers['Idempotency-Key']});
  }

  Future<Object?> _read(Stream<Uint8List>? stream) async {
    if (stream == null) return null;
    final bytes = await stream.fold<List<int>>([], (a, b) => a..addAll(b));
    if (bytes.isEmpty) return null;
    return jsonDecode(utf8.decode(bytes));
  }

  ResponseBody _json(int status, Object? body) => ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );

  @override
  void close({bool force = false}) {}
}
