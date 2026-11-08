import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../../core/providers.dart';
import '../data/auth_models.dart';

enum AuthStatus {
  /// Checking stored tokens on launch.
  restoring,
  signedOut,
  signedIn,

  /// Tokens exist but the server could not be reached to confirm the session.
  offline,
}

class AuthState {
  const AuthState(this.status, {this.user, this.notice});

  final AuthStatus status;
  final CurrentUser? user;

  /// One-off message for the sign-in screen, e.g. why the user was signed out.
  final String? notice;

  static const restoring = AuthState(AuthStatus.restoring);
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    Future.microtask(restore);
    return AuthState.restoring;
  }

  /// On launch: a stored session is only trusted once the server confirms it.
  Future<void> restore() async {
    final tokens = await ref.read(tokenStoreProvider).read();
    if (tokens == null) {
      state = const AuthState(AuthStatus.signedOut);
      return;
    }
    await _loadUser();
  }

  Future<void> signIn(String email, String password) async {
    final pair = await ref.read(authApiProvider).login(email.trim(), password);
    await ref.read(tokenStoreProvider).write(pair);
    await _loadUser();
  }

  Future<void> register({required String fullName, required String email, required String password}) async {
    final pair = await ref.read(authApiProvider).register(fullName: fullName.trim(), email: email.trim(), password: password);
    await ref.read(tokenStoreProvider).write(pair);
    await _loadUser();
  }

  Future<void> refreshUser() => _loadUser();

  /// Signing out of this device is immediate and never waits on the network: local tokens are
  /// cleared first, then the server session is revoked in the background (if that fails, the
  /// session simply expires). Signing out of all devices is a remote action, so it waits for the
  /// server and throws [ApiError] if it could not be done — the user stays signed in to retry.
  Future<void> signOut({bool allDevices = false}) async {
    final store = ref.read(tokenStoreProvider);
    final api = ref.read(authApiProvider);
    if (allDevices) {
      await api.logout(allDevices: true);
      await store.clear();
      state = const AuthState(AuthStatus.signedOut);
      return;
    }
    final tokens = await store.read();
    await store.clear();
    state = const AuthState(AuthStatus.signedOut);
    if (tokens != null) {
      unawaited(api.logout(accessToken: tokens.accessToken).catchError((Object _) {}));
    }
  }

  void sessionExpired() {
    state = const AuthState(AuthStatus.signedOut, notice: 'Your session has ended. Sign in again.');
  }

  Future<void> _loadUser() async {
    try {
      final user = await ref.read(authApiProvider).me();
      state = AuthState(AuthStatus.signedIn, user: user);
    } on ApiError catch (e) {
      if (e.isOffline) {
        state = AuthState(AuthStatus.offline, user: state.user);
      } else {
        await ref.read(tokenStoreProvider).clear();
        state = AuthState(AuthStatus.signedOut, notice: e.kind == ApiErrorKind.unauthorized ? 'Your session has ended. Sign in again.' : e.message);
      }
    }
  }
}
