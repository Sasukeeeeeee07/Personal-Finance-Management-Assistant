import 'dart:async';

import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';

import 'api_error.dart';
import 'token_store.dart';

/// The single HTTP client for the backend (`/api/v1`).
///
/// * Attaches the access token to authenticated requests.
/// * On a 401, refreshes the session **once** even when many requests fail together
///   (single-flight), then retries each failed request exactly once with the new token.
/// * Refresh tokens are single-use on the server, so a second concurrent refresh would revoke the
///   whole session; the single-flight lock prevents that.
/// * If the refresh is rejected, tokens are cleared and [onSessionExpired] fires. If it fails
///   because the device is offline, tokens are kept and the request fails with an offline error.
/// * Every failure surfaces as an [ApiError].
class ApiClient {
  ApiClient({
    required String baseUrl,
    required TokenStore tokens,
    HttpClientAdapter? adapter,
    this.onSessionExpired,
    Duration connectTimeout = const Duration(seconds: 10),
    Duration receiveTimeout = const Duration(seconds: 20),
  }) : _tokens = tokens {
    final options = BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: connectTimeout,
      receiveTimeout: receiveTimeout,
      sendTimeout: receiveTimeout,
      contentType: Headers.jsonContentType,
      responseType: ResponseType.json,
    );
    dio = Dio(options);
    _refreshDio = Dio(options);
    if (adapter != null) {
      dio.httpClientAdapter = adapter;
      _refreshDio.httpClientAdapter = adapter;
    }
    dio.interceptors.add(InterceptorsWrapper(onRequest: _attachToken, onError: _onError));
  }

  late final Dio dio;
  late final Dio _refreshDio;
  final TokenStore _tokens;
  void Function()? onSessionExpired;
  Future<TokenPair?>? _refreshInFlight;

  static const _uuid = Uuid();

  /// A fresh key for a mutation that may be retried or replayed from an offline queue.
  static String newIdempotencyKey() => 'm-${_uuid.v4()}';

  Future<T> get<T>(String path, {Map<String, dynamic>? query, CancelToken? cancelToken, bool auth = true}) =>
      _send<T>(() => dio.get(path, queryParameters: query, cancelToken: cancelToken, options: _opts(auth)));

  /// [bearer] sends an explicit access token without refresh handling (used after local sign-out).
  Future<T> post<T>(String path, {Object? body, CancelToken? cancelToken, bool auth = true, String? idempotencyKey, String? bearer}) {
    final options = _opts(bearer == null && auth, idempotencyKey);
    if (bearer != null) options.headers!['Authorization'] = 'Bearer $bearer';
    return _send<T>(() => dio.post(path, data: body, cancelToken: cancelToken, options: options));
  }

  Future<T> patch<T>(String path, {Object? body, CancelToken? cancelToken}) =>
      _send<T>(() => dio.patch(path, data: body, cancelToken: cancelToken, options: _opts(true)));

  Future<T> delete<T>(String path, {CancelToken? cancelToken}) => _send<T>(() => dio.delete(path, cancelToken: cancelToken, options: _opts(true)));

  Options _opts(bool auth, [String? idempotencyKey]) =>
      Options(extra: {'auth': auth}, headers: {if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey});

  Future<T> _send<T>(Future<Response<dynamic>> Function() call) async {
    try {
      final res = await call();
      return res.data as T;
    } on DioException catch (e) {
      final inner = e.error;
      if (inner is ApiError) throw inner;
      throw ApiError.fromDio(e);
    }
  }

  Future<void> _attachToken(RequestOptions options, RequestInterceptorHandler handler) async {
    if (options.extra['auth'] != false) {
      final tokens = await _tokens.read();
      if (tokens != null) options.headers['Authorization'] = 'Bearer ${tokens.accessToken}';
    }
    handler.next(options);
  }

  Future<void> _onError(DioException err, ErrorInterceptorHandler handler) async {
    final req = err.requestOptions;
    final isAuthed = req.extra['auth'] != false;
    final alreadyRetried = req.extra['retried'] == true;
    if (err.response?.statusCode != 401 || !isAuthed || alreadyRetried) return handler.next(err);

    final usedHeader = req.headers['Authorization'] as String?;
    final usedToken = usedHeader?.startsWith('Bearer ') == true ? usedHeader!.substring(7) : null;
    TokenPair? fresh;
    try {
      fresh = await _refreshOnce(usedToken);
    } on ApiError catch (e) {
      return handler.next(DioException(requestOptions: req, error: e, type: DioExceptionType.unknown));
    }
    if (fresh == null) return handler.next(err);

    final retryOptions = req.copyWith(extra: {...req.extra, 'retried': true}, headers: {...req.headers, 'Authorization': 'Bearer ${fresh.accessToken}'});
    try {
      handler.resolve(await dio.fetch(retryOptions));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  /// Refreshes the session at most once at a time. Returns null when the session has ended.
  Future<TokenPair?> _refreshOnce(String? failedAccessToken) async {
    final current = await _tokens.read();
    if (current == null) return null;
    // Another request already refreshed after this one was sent.
    if (failedAccessToken != null && current.accessToken != failedAccessToken) return current;
    return _refreshInFlight ??= _doRefresh(current.refreshToken).whenComplete(() => _refreshInFlight = null);
  }

  Future<TokenPair?> _doRefresh(String refreshToken) async {
    try {
      final res = await _refreshDio.post('/auth/refresh', data: {'refreshToken': refreshToken});
      final pair = TokenPair.fromJson(res.data as Map<String, dynamic>);
      await _tokens.write(pair);
      return pair;
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 400) {
        await _tokens.clear();
        onSessionExpired?.call();
        return null;
      }
      // Offline or server trouble: keep the session and report the transport error.
      throw ApiError.fromDio(e);
    }
  }
}
