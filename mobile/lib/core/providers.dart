import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/auth/data/auth_api.dart';
import '../features/auth/state/auth_controller.dart';
import 'api/api_client.dart';
import 'api/token_store.dart';
import 'config/app_config.dart';

final appConfigProvider = Provider<AppConfig>((ref) => AppConfig.fromEnvironment());

final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  final config = ref.watch(appConfigProvider);
  final client = ApiClient(baseUrl: config.apiBaseUrl, tokens: ref.watch(tokenStoreProvider), receiveTimeout: config.receiveTimeout);
  // A rejected refresh means the session ended elsewhere (logout, password reset, token reuse).
  client.onSessionExpired = () => ref.read(authControllerProvider.notifier).sessionExpired();
  return client;
});

final authApiProvider = Provider<AuthApi>((ref) => AuthApi(ref.watch(apiClientProvider)));
