import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/state/auth_controller.dart';
import '../../features/auth/ui/forgot_password_screen.dart';
import '../../features/auth/ui/register_screen.dart';
import '../../features/auth/ui/sign_in_screen.dart';
import '../../features/auth/ui/status_screens.dart';
import '../../features/dashboard/ui/dashboard_screen.dart';
import '../../features/profile/profile_screen.dart';
import '../../features/shell/home_shell.dart';
import '../../features/transactions/ui/transaction_detail_screen.dart';

abstract final class Routes {
  static const restoring = '/loading';
  static const offline = '/offline';
  static const signIn = '/sign-in';
  static const register = '/register';
  static const forgotPassword = '/forgot-password';

  static const home = '/dashboard';
  static const profile = '/profile';

  static const publicRoutes = {signIn, register, forgotPassword};
}

/// Pure redirect rule, unit-tested separately.
String? authRedirect(AuthStatus status, String location) {
  switch (status) {
    case AuthStatus.restoring:
      return location == Routes.restoring ? null : Routes.restoring;
    case AuthStatus.offline:
      return location == Routes.offline ? null : Routes.offline;
    case AuthStatus.signedOut:
      return Routes.publicRoutes.contains(location) ? null : Routes.signIn;
    case AuthStatus.signedIn:
      final onGate = Routes.publicRoutes.contains(location) || location == Routes.restoring || location == Routes.offline;
      return onGate ? Routes.home : null;
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  // GoRouter re-evaluates redirects whenever the auth status changes.
  final status = ValueNotifier(ref.read(authControllerProvider).status);
  ref.listen(authControllerProvider.select((s) => s.status), (_, next) => status.value = next);
  ref.onDispose(status.dispose);

  return GoRouter(
    initialLocation: Routes.restoring,
    refreshListenable: status,
    redirect: (context, state) => authRedirect(status.value, state.matchedLocation),
    routes: [
      GoRoute(path: Routes.restoring, builder: (_, __) => const RestoringScreen()),
      GoRoute(path: Routes.offline, builder: (_, __) => const OfflineScreen()),
      GoRoute(path: Routes.signIn, builder: (_, __) => const SignInScreen()),
      GoRoute(path: Routes.register, builder: (_, __) => const RegisterScreen()),
      GoRoute(path: Routes.forgotPassword, builder: (_, __) => const ForgotPasswordScreen()),
      StatefulShellRoute.indexedStack(
        builder: (_, __, shell) => HomeShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: Routes.home, builder: (_, __) => const DashboardScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: Routes.profile, builder: (_, __) => const ProfileScreen())],
          ),
        ],
      ),
      GoRoute(
        path: '/transactions/:id',
        builder: (_, state) => TransactionDetailScreen(id: state.pathParameters['id']!),
      ),
    ],
  );
});
