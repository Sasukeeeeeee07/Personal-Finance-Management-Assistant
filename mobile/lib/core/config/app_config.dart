import 'package:flutter/foundation.dart';

/// Build-time configuration. Pass with `--dart-define=API_BASE_URL=https://api.example.com/api/v1`.
/// Defaults target a backend running locally: the Android emulator reaches the host at 10.0.2.2.
class AppConfig {
  const AppConfig({required this.apiBaseUrl});

  final String apiBaseUrl;

  factory AppConfig.fromEnvironment() {
    const fromDefine = String.fromEnvironment('API_BASE_URL');
    if (fromDefine.isNotEmpty) return const AppConfig(apiBaseUrl: fromDefine);
    final local = !kIsWeb && defaultTargetPlatform == TargetPlatform.android ? 'http://10.0.2.2:4000/api/v1' : 'http://localhost:4000/api/v1';
    return AppConfig(apiBaseUrl: local);
  }
}
