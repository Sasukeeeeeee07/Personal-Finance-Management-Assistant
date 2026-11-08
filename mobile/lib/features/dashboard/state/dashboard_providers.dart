import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../auth/state/auth_controller.dart';
import '../data/dashboard_api.dart';
import '../data/dashboard_models.dart';

final dashboardApiProvider = Provider<DashboardApi>((ref) => DashboardApi(ref.watch(apiClientProvider)));

/// Failures are shown to the user with a retry action instead of being retried silently.
Duration? _noAutoRetry(int retryCount, Object error) => null;

/// Each section loads independently, so one slow or failing endpoint never blanks the others.
/// Every provider is keyed to the signed-in user: signing in as someone else starts from empty,
/// so one person's figures can never flash on another person's screen.
String? _userId(Ref ref) => ref.watch(authControllerProvider.select((s) => s.user?.id));

final dashboardSummaryProvider = FutureProvider<DashboardSummary>((ref) {
  _userId(ref);
  return ref.watch(dashboardApiProvider).summary();
}, retry: _noAutoRetry);

final budgetsProvider = FutureProvider<List<BudgetStatus>>((ref) {
  _userId(ref);
  return ref.watch(dashboardApiProvider).budgets();
}, retry: _noAutoRetry);

final forecastProvider = FutureProvider<Forecast>((ref) {
  _userId(ref);
  return ref.watch(dashboardApiProvider).forecast();
}, retry: _noAutoRetry);

final recentTransactionsProvider = FutureProvider<List<TransactionItem>>((ref) {
  _userId(ref);
  return ref.watch(dashboardApiProvider).recentTransactions();
}, retry: _noAutoRetry);

final lookupsProvider = FutureProvider<Lookups>((ref) {
  _userId(ref);
  return ref.watch(dashboardApiProvider).lookups();
}, retry: _noAutoRetry);

final transactionDetailProvider = FutureProvider.autoDispose.family<TransactionDetail, String>((ref, id) {
  _userId(ref);
  return ref.watch(dashboardApiProvider).transaction(id);
}, retry: _noAutoRetry);

/// Pull-to-refresh: reloads every section and completes when all have settled (success or error).
Future<void> refreshDashboard(WidgetRef ref) async {
  final futures = <Future<Object?>>[
    ref.refresh(dashboardSummaryProvider.future),
    ref.refresh(budgetsProvider.future),
    ref.refresh(forecastProvider.future),
    ref.refresh(recentTransactionsProvider.future),
    ref.refresh(lookupsProvider.future),
  ];
  await Future.wait(futures.map((f) => f.then<Object?>((v) => v, onError: (Object _) => null)));
}
