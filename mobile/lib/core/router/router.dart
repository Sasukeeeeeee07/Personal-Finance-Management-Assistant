import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/accounts/accounts_screens.dart';
import '../../features/auth/state/auth_controller.dart';
import '../../features/auth/ui/forgot_password_screen.dart';
import '../../features/auth/ui/link_screens.dart';
import '../../features/auth/ui/register_screen.dart';
import '../../features/auth/ui/sign_in_screen.dart';
import '../../features/auth/ui/status_screens.dart';
import '../../features/dashboard/ui/dashboard_screen.dart';
import '../../features/goals/goals_screens.dart';
import '../../features/plan/plan_screens.dart';
import '../../features/profile/profile_screen.dart';
import '../../features/reports/reports_screen.dart';
import '../../features/shell/home_shell.dart';
import '../../features/transactions/ui/transaction_detail_screen.dart';
import '../../features/transactions/ui/transaction_form_screen.dart';
import '../../features/transactions/ui/transactions_screen.dart';

abstract final class Routes {
  static const restoring = '/loading';
  static const offline = '/offline';
  static const signIn = '/sign-in';
  static const register = '/register';
  static const forgotPassword = '/forgot-password';
  static const resetPassword = '/reset-password';
  static const verifyEmail = '/verify-email';

  static const home = '/dashboard';
  static const transactions = '/transactions';
  static const plan = '/plan';
  static const goals = '/goals';
  static const profile = '/profile';

  static const publicRoutes = {signIn, register, forgotPassword};

  /// Opened from emails; usable whether or not the person is signed in.
  static const linkRoutes = {resetPassword, verifyEmail};
}

/// Pure redirect rule, unit-tested separately. [uri] is the full requested location (path + query).
/// While a stored session is being restored, the requested page is remembered in `from`, so a
/// browser refresh on e.g. /goals returns to /goals instead of Home.
String? authRedirect(AuthStatus status, String location, {String? uri}) {
  if (Routes.linkRoutes.contains(location)) return null;
  final full = uri ?? location;
  switch (status) {
    case AuthStatus.restoring:
      if (location == Routes.restoring) return null;
      return '${Routes.restoring}?from=${Uri.encodeComponent(full)}';
    case AuthStatus.offline:
      return location == Routes.offline ? null : Routes.offline;
    case AuthStatus.signedOut:
      return Routes.publicRoutes.contains(location) ? null : Routes.signIn;
    case AuthStatus.signedIn:
      if (location == Routes.restoring) {
        final from = Uri.tryParse(full)?.queryParameters['from'];
        final fromPath = from == null ? null : Uri.tryParse(from)?.path;
        final ok =
            fromPath != null &&
            fromPath.startsWith('/') &&
            !Routes.publicRoutes.contains(fromPath) &&
            fromPath != Routes.restoring &&
            fromPath != Routes.offline;
        return ok ? from : Routes.home;
      }
      final onGate = Routes.publicRoutes.contains(location) || location == Routes.offline;
      return onGate ? Routes.home : null;
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  // GoRouter re-evaluates redirects whenever the auth status changes.
  final status = ValueNotifier(ref.read(authControllerProvider).status);
  ref.listen(authControllerProvider.select((s) => s.status), (_, next) => status.value = next);
  ref.onDispose(status.dispose);

  return GoRouter(
    initialLocation: Routes.home,
    refreshListenable: status,
    redirect: (context, state) => authRedirect(status.value, state.matchedLocation, uri: state.uri.toString()),
    routes: [
      GoRoute(path: Routes.restoring, builder: (_, __) => const RestoringScreen()),
      GoRoute(path: Routes.offline, builder: (_, __) => const OfflineScreen()),
      GoRoute(path: Routes.signIn, builder: (_, __) => const SignInScreen()),
      GoRoute(path: Routes.register, builder: (_, __) => const RegisterScreen()),
      GoRoute(path: Routes.forgotPassword, builder: (_, __) => const ForgotPasswordScreen()),
      GoRoute(
        path: Routes.resetPassword,
        builder: (_, s) => ResetPasswordScreen(token: s.uri.queryParameters['token']),
      ),
      GoRoute(
        path: Routes.verifyEmail,
        builder: (_, s) => VerifyEmailScreen(token: s.uri.queryParameters['token']),
      ),
      StatefulShellRoute.indexedStack(
        builder: (_, __, shell) => HomeShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: Routes.home, builder: (_, __) => const DashboardScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: Routes.transactions, builder: (_, __) => const TransactionsScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: Routes.plan, builder: (_, __) => const PlanScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: Routes.goals, builder: (_, __) => const GoalsScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: Routes.profile, builder: (_, __) => const ProfileScreen())],
          ),
        ],
      ),
      // Form routes carry their arguments in `extra`; after a browser refresh `extra` is gone, so
      // edit falls back to the list instead of showing an empty form.
      GoRoute(
        path: '/transactions/new',
        builder: (_, s) => TransactionFormScreen(args: s.extra is TransactionFormArgs ? s.extra! as TransactionFormArgs : const TransactionFormArgs()),
      ),
      GoRoute(
        path: '/transactions/edit',
        redirect: (_, s) => s.extra is TransactionFormArgs ? null : Routes.transactions,
        builder: (_, s) => TransactionFormScreen(args: s.extra! as TransactionFormArgs),
      ),
      GoRoute(
        path: '/transactions/:id',
        builder: (_, s) => TransactionDetailScreen(id: s.pathParameters['id']!),
      ),
      GoRoute(path: '/accounts', builder: (_, __) => const AccountsScreen()),
      GoRoute(path: '/accounts/new', builder: (_, __) => const AccountFormScreen()),
      GoRoute(
        path: '/accounts/:id',
        builder: (_, s) => AccountDetailScreen(id: s.pathParameters['id']!),
      ),
      GoRoute(path: '/budgets/new', builder: (_, __) => const BudgetFormScreen()),
      GoRoute(path: '/money-lock/new', builder: (_, __) => const CommitmentFormScreen()),
      GoRoute(path: '/goals/new', builder: (_, __) => const GoalFormScreen()),
      GoRoute(
        path: '/goals/:id',
        builder: (_, s) => GoalDetailScreen(id: s.pathParameters['id']!),
      ),
      GoRoute(path: '/reports', builder: (_, __) => const ReportsScreen()),
    ],
  );
});
