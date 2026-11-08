import '../../../core/api/api_client.dart';
import '../../../core/api/token_store.dart';
import 'auth_models.dart';

/// Thin typed wrapper over the `/auth` endpoints.
class AuthApi {
  AuthApi(this._client);

  final ApiClient _client;

  Future<TokenPair> login(String email, String password) async =>
      TokenPair.fromJson(await _client.post<Map<String, dynamic>>('/auth/login', body: {'email': email, 'password': password}, auth: false));

  Future<TokenPair> register({required String fullName, required String email, required String password}) async => TokenPair.fromJson(
    await _client.post<Map<String, dynamic>>('/auth/register', body: {'fullName': fullName, 'email': email, 'password': password}, auth: false),
  );

  Future<void> forgotPassword(String email) => _client.post<dynamic>('/auth/forgot-password', body: {'email': email}, auth: false);

  Future<CurrentUser> me() async => CurrentUser.fromJson(await _client.get<Map<String, dynamic>>('/auth/me'));

  Future<void> resendVerification() => _client.post<dynamic>('/auth/resend-verification');

  /// With [accessToken], revokes that session even after the local tokens were cleared.
  Future<void> logout({bool allDevices = false, String? accessToken}) =>
      _client.post<dynamic>('/auth/logout', body: {'allDevices': allDevices}, bearer: accessToken);

  Future<List<ActiveSession>> sessions() async =>
      (await _client.get<List<dynamic>>('/auth/sessions')).map((s) => ActiveSession.fromJson(s as Map<String, dynamic>)).toList();
}
