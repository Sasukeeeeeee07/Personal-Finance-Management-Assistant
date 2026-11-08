import 'package:dio/dio.dart';

enum ApiErrorKind {
  /// No connection to the server (offline, DNS, refused).
  offline,
  timeout,
  cancelled,
  unauthorized,
  forbidden,
  notFound,
  validation,
  conflict,
  rateLimited,
  server,
  unknown,
}

/// Structured error built from the backend's uniform error body
/// `{ statusCode, code, message, fields?, details? }` or from a transport failure.
class ApiError implements Exception {
  const ApiError({required this.kind, required this.message, this.statusCode, this.code, this.fields = const {}, this.details});

  final ApiErrorKind kind;
  final String message;
  final int? statusCode;
  final String? code;

  /// Field name → messages, for 400 validation errors.
  final Map<String, List<String>> fields;
  final Object? details;

  bool get isOffline => kind == ApiErrorKind.offline || kind == ApiErrorKind.timeout;

  String? fieldError(String field) => fields[field]?.join(' ');

  factory ApiError.fromDio(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.transformTimeout:
        return const ApiError(kind: ApiErrorKind.timeout, message: 'The server is taking too long to respond. Check your connection and try again.');
      case DioExceptionType.connectionError:
        return const ApiError(kind: ApiErrorKind.offline, message: "You're offline. Check your connection and try again.");
      case DioExceptionType.cancel:
        return const ApiError(kind: ApiErrorKind.cancelled, message: 'Request cancelled.');
      case DioExceptionType.badCertificate:
        return const ApiError(kind: ApiErrorKind.unknown, message: "We couldn't make a secure connection to the server.");
      case DioExceptionType.badResponse:
      case DioExceptionType.unknown:
        break;
    }
    final response = e.response;
    if (response == null) {
      return const ApiError(kind: ApiErrorKind.offline, message: "You're offline. Check your connection and try again.");
    }
    return ApiError.fromResponse(response.statusCode ?? 0, response.data);
  }

  factory ApiError.fromResponse(int status, Object? data) {
    final body = data is Map ? data : const {};
    final rawMessage = body['message'];
    final message = rawMessage is String && rawMessage.isNotEmpty ? rawMessage : _defaultMessage(status);
    final fields = <String, List<String>>{};
    final rawFields = body['fields'];
    if (rawFields is Map) {
      rawFields.forEach((k, v) => fields['$k'] = v is List ? v.map((x) => '$x').toList() : ['$v']);
    }
    return ApiError(
      kind: _kindFor(status, fields.isNotEmpty),
      message: message,
      statusCode: status,
      code: body['code'] as String?,
      fields: fields,
      details: body['details'],
    );
  }

  static ApiErrorKind _kindFor(int status, bool hasFields) {
    if (status == 400 && hasFields) return ApiErrorKind.validation;
    if (status == 401) return ApiErrorKind.unauthorized;
    if (status == 403) return ApiErrorKind.forbidden;
    if (status == 404) return ApiErrorKind.notFound;
    if (status == 409) return ApiErrorKind.conflict;
    if (status == 400 || status == 422) return ApiErrorKind.validation;
    if (status == 429) return ApiErrorKind.rateLimited;
    if (status >= 500) return ApiErrorKind.server;
    return ApiErrorKind.unknown;
  }

  static String _defaultMessage(int status) =>
      status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Something went wrong. Please try again.';

  @override
  String toString() => 'ApiError($kind, $statusCode, $code, $message)';
}
