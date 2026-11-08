import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class TokenPair {
  const TokenPair({required this.accessToken, required this.refreshToken});

  final String accessToken;
  final String refreshToken;

  factory TokenPair.fromJson(Map<String, dynamic> json) => TokenPair(accessToken: json['accessToken'] as String, refreshToken: json['refreshToken'] as String);
}

/// Where session tokens live. Never logged, never kept outside this store.
abstract class TokenStore {
  Future<TokenPair?> read();
  Future<void> write(TokenPair tokens);
  Future<void> clear();
}

/// Android Keystore / iOS Keychain backed storage.
class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage])
    : _storage =
          storage ??
          const FlutterSecureStorage(
            // v10 encrypts with Android Keystore-backed ciphers by default.
            aOptions: AndroidOptions(),
            iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
          );

  final FlutterSecureStorage _storage;
  static const _access = 'pfm.access_token';
  static const _refresh = 'pfm.refresh_token';

  @override
  Future<TokenPair?> read() async {
    final access = await _storage.read(key: _access);
    final refresh = await _storage.read(key: _refresh);
    if (access == null || refresh == null) return null;
    return TokenPair(accessToken: access, refreshToken: refresh);
  }

  @override
  Future<void> write(TokenPair tokens) async {
    await _storage.write(key: _access, value: tokens.accessToken);
    await _storage.write(key: _refresh, value: tokens.refreshToken);
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
  }
}

/// For tests.
class MemoryTokenStore implements TokenStore {
  MemoryTokenStore([this._tokens]);
  TokenPair? _tokens;

  @override
  Future<TokenPair?> read() async => _tokens;
  @override
  Future<void> write(TokenPair tokens) async => _tokens = tokens;
  @override
  Future<void> clear() async => _tokens = null;
}
