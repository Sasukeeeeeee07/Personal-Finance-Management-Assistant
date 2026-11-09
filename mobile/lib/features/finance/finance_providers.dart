import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../auth/state/auth_controller.dart';
import '../dashboard/data/dashboard_models.dart';
import '../dashboard/state/dashboard_providers.dart';
import 'finance_api.dart';
import 'finance_models.dart';

final financeApiProvider = Provider<FinanceApi>((ref) => FinanceApi(ref.watch(apiClientProvider)));

Duration? _noAutoRetry(int retryCount, Object error) => null;

/// Keyed to the signed-in user so one person's data never shows for another.
String? _user(Ref ref) => ref.watch(authControllerProvider.select((s) => s.user?.id));

final accountsProvider = FutureProvider<List<Account>>((ref) {
  _user(ref);
  return ref.watch(financeApiProvider).accounts(includeArchived: true);
}, retry: _noAutoRetry);

final commitmentsProvider = FutureProvider<List<Commitment>>((ref) {
  _user(ref);
  return ref.watch(financeApiProvider).commitments();
}, retry: _noAutoRetry);

final activeReservationsProvider = FutureProvider<List<Reservation>>((ref) {
  _user(ref);
  return ref.watch(financeApiProvider).reservations();
}, retry: _noAutoRetry);

final goalsProvider = FutureProvider<List<Goal>>((ref) {
  _user(ref);
  return ref.watch(financeApiProvider).goals();
}, retry: _noAutoRetry);

final goalDetailProvider = FutureProvider.autoDispose.family<GoalDetail, String>((ref, id) {
  _user(ref);
  return ref.watch(financeApiProvider).goal(id);
}, retry: _noAutoRetry);

final monthlyReportProvider = FutureProvider.autoDispose.family<MonthlyReport, String>((ref, month) {
  _user(ref);
  return ref.watch(financeApiProvider).monthlyReport(month);
}, retry: _noAutoRetry);

/// Filter for the transactions list.
class TransactionFilter {
  const TransactionFilter({this.type, this.accountId});

  final String? type;
  final String? accountId;

  @override
  bool operator ==(Object other) => other is TransactionFilter && other.type == type && other.accountId == accountId;

  @override
  int get hashCode => Object.hash(type, accountId);
}

/// Paged transaction list. Pages are appended with [loadMore]; a refresh starts again from page 1.
class TransactionsListController extends AsyncNotifier<TransactionPage> {
  TransactionsListController(this.filter);

  final TransactionFilter filter;
  bool _loadingMore = false;

  @override
  Future<TransactionPage> build() {
    _user(ref);
    return ref.watch(financeApiProvider).transactions(type: filter.type, accountId: filter.accountId);
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || _loadingMore) return;
    _loadingMore = true;
    try {
      final next = await ref.read(financeApiProvider).transactions(page: current.page + 1, type: filter.type, accountId: filter.accountId);
      state = AsyncData(TransactionPage(items: [...current.items, ...next.items], page: next.page, total: next.total));
    } finally {
      _loadingMore = false;
    }
  }
}

final transactionsListProvider = AsyncNotifierProvider.autoDispose.family<TransactionsListController, TransactionPage, TransactionFilter>(
  TransactionsListController.new,
  retry: _noAutoRetry,
);

/// After any successful change, reload everything that shows money so no screen keeps stale
/// figures. The backend recomputes; the app never patches numbers locally.
void refreshFinancialData(WidgetRef ref) {
  ref.invalidate(dashboardSummaryProvider);
  ref.invalidate(budgetsProvider);
  ref.invalidate(forecastProvider);
  ref.invalidate(recentTransactionsProvider);
  ref.invalidate(lookupsProvider);
  ref.invalidate(transactionDetailProvider);
  ref.invalidate(accountsProvider);
  ref.invalidate(transactionsListProvider);
  ref.invalidate(commitmentsProvider);
  ref.invalidate(activeReservationsProvider);
  ref.invalidate(goalsProvider);
  ref.invalidate(goalDetailProvider);
  ref.invalidate(monthlyReportProvider);
}

/// Categories for pickers, from the lookups already loaded for the dashboard.
List<CategoryRef> categoriesOf(Lookups l, String kind) => l.categories.values.where((c) => c.kind == kind).toList()..sort((a, b) => a.name.compareTo(b.name));
