import '../../core/api/api_client.dart';
import '../dashboard/data/dashboard_models.dart';
import 'finance_models.dart';

/// Typed wrapper over the management endpoints. The app sends what the user entered; the backend
/// validates, applies the financial rules and returns the authoritative result.
class FinanceApi {
  FinanceApi(this._c);

  final ApiClient _c;

  // --- accounts ---------------------------------------------------------------------------------
  Future<List<Account>> accounts({bool includeArchived = false}) async =>
      (await _c.get<List<dynamic>>('/accounts', query: {'includeArchived': includeArchived})).map((a) => Account.fromJson(a as Json)).toList();

  Future<Account> createAccount(Map<String, dynamic> body) async => Account.fromJson(await _c.post<Json>('/accounts', body: body));

  Future<Account> updateAccount(String id, Map<String, dynamic> body) async => Account.fromJson(await _c.patch<Json>('/accounts/$id', body: body));

  Future<Json> reconcile(String id, String actualBalance) => _c.post<Json>('/accounts/$id/reconcile', body: {'actualBalance': actualBalance});

  // --- transactions -----------------------------------------------------------------------------
  Future<TransactionPage> transactions({int page = 1, int pageSize = 30, String? type, String? accountId, String? search}) async {
    final r = await _c.get<Json>(
      '/transactions',
      query: {
        'page': page,
        'pageSize': pageSize,
        'sort': 'occurredAt:desc',
        'type': ?type,
        'accountId': ?accountId,
        if (search != null && search.isNotEmpty) 'search': search,
      },
    );
    return TransactionPage(
      items: (r['items'] as List).map((t) => TransactionItem.fromJson(t as Json)).toList(),
      page: r['page'] as int,
      total: r['total'] as int,
    );
  }

  /// The idempotency key makes a retry (e.g. after a timeout) safe: the server returns the original
  /// transaction instead of recording it twice.
  Future<CreatedTransaction> createTransaction(Map<String, dynamic> body, {required String idempotencyKey}) async =>
      CreatedTransaction.fromJson(await _c.post<Json>('/transactions', body: body, idempotencyKey: idempotencyKey));

  Future<TransactionItem> updateTransaction(String id, Map<String, dynamic> body) async =>
      TransactionItem.fromJson(await _c.patch<Json>('/transactions/$id', body: body));

  Future<void> deleteTransaction(String id) => _c.delete<dynamic>('/transactions/$id');

  // --- Money Lock -------------------------------------------------------------------------------
  Future<List<Commitment>> commitments() async => (await _c.get<List<dynamic>>('/commitments')).map((c) => Commitment.fromJson(c as Json)).toList();

  Future<void> createCommitment(Map<String, dynamic> body) => _c.post<dynamic>('/commitments', body: body);

  Future<void> cancelCommitment(String id) => _c.delete<dynamic>('/commitments/$id');

  Future<List<Reservation>> reservations({String status = 'active'}) async =>
      (await _c.get<List<dynamic>>('/reservations', query: {'status': status})).map((r) => Reservation.fromJson(r as Json)).toList();

  Future<void> adjustReservation(String id, String reservedAmount) => _c.patch<dynamic>('/reservations/$id', body: {'reservedAmount': reservedAmount});

  Future<void> releaseReservation(String id) => _c.post<dynamic>('/reservations/$id/release');

  // --- budgets ----------------------------------------------------------------------------------
  Future<void> createBudget(Map<String, dynamic> body) => _c.post<dynamic>('/budgets', body: body);

  Future<void> updateBudget(String id, Map<String, dynamic> body) => _c.patch<dynamic>('/budgets/$id', body: body);

  Future<void> archiveBudget(String id) => _c.delete<dynamic>('/budgets/$id');

  // --- goals ------------------------------------------------------------------------------------
  Future<List<Goal>> goals() async => (await _c.get<List<dynamic>>('/goals')).map((g) => Goal.fromJson(g as Json)).toList();

  Future<GoalDetail> goal(String id) async => GoalDetail.fromJson(await _c.get<Json>('/goals/$id'));

  Future<void> createGoal(Map<String, dynamic> body) => _c.post<dynamic>('/goals', body: body);

  Future<void> updateGoal(String id, Map<String, dynamic> body) => _c.patch<dynamic>('/goals/$id', body: body);

  Future<void> contribute(String id, Map<String, dynamic> body, {required String idempotencyKey}) =>
      _c.post<dynamic>('/goals/$id/contributions', body: body, idempotencyKey: idempotencyKey);

  Future<void> reverseContribution(String goalId, String contributionId) => _c.post<dynamic>('/goals/$goalId/contributions/$contributionId/reverse');

  Future<void> completeGoal(String id) => _c.post<dynamic>('/goals/$id/complete');

  Future<void> archiveGoal(String id) => _c.post<dynamic>('/goals/$id/archive');

  // --- reports ----------------------------------------------------------------------------------
  Future<MonthlyReport> monthlyReport(String month) async => MonthlyReport.fromJson(await _c.get<Json>('/reports/monthly', query: {'month': month}));
}
