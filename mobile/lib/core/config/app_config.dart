import 'package:flutter/foundation.dart';

/// Build-time configuration, passed with `--dart-define`:
///   API_BASE_URL=https://your-api.onrender.com/api/v1
///   API_TIMEOUT_SECONDS=75   (free hosting sleeps when idle; the first request waits for it to wake)
/// Defaults target a backend running locally: the Android emulator reaches the host at 10.0.2.2.
/// Never put secrets here: everything in a web build is readable by anyone who loads the page.
class AppConfig {
  const AppConfig({required this.apiBaseUrl, this.receiveTimeout = const Duration(seconds: 20)});

  final String apiBaseUrl;

  /// How long to wait for a response. Raise it for hosts with cold starts.
  final Duration receiveTimeout;

  factory AppConfig.fromEnvironment() {
    const fromDefine = String.fromEnvironment('API_BASE_URL');
    const timeoutSeconds = int.fromEnvironment('API_TIMEOUT_SECONDS', defaultValue: 20);
    final local = !kIsWeb && defaultTargetPlatform == TargetPlatform.android ? 'http://10.0.2.2:4000/api/v1' : 'http://localhost:4000/api/v1';
    return AppConfig(
      apiBaseUrl: fromDefine.isNotEmpty ? fromDefine : local,
      receiveTimeout: Duration(seconds: timeoutSeconds),
    );
  }
}
