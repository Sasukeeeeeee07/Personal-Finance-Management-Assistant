import 'package:dio/dio.dart';

import '../../../core/api/api_client.dart';
import 'dashboard_models.dart';

/// Read-only access to the endpoints behind the dashboard. Every figure comes from the backend.
class DashboardApi {
  DashboardApi(this._client);

  final ApiClient _client;

  Future<DashboardSummary> summary({CancelToken? cancel}) async =>
      DashboardSummary.fromJson(await _client.get<Map<String, dynamic>>('/dashboard/summary', cancelToken: cancel));

  Future<List<BudgetStatus>> budgets({CancelToken? cancel}) async =>
      (await _client.get<List<dynamic>>('/budgets', cancelToken: cancel)).map((b) => BudgetStatus.fromJson(b as Map<String, dynamic>)).toList();

  Future<Forecast> forecast({CancelToken? cancel}) async =>
      Forecast.fromJson(await _client.get<Map<String, dynamic>>('/forecast/month-end', cancelToken: cancel));

  /// Latest confirmed transactions (income, expenses and transfers), newest first.
  Future<List<TransactionItem>> recentTransactions({int limit = 5, CancelToken? cancel}) async {
    final page = await _client.get<Map<String, dynamic>>(
      '/transactions',
      query: {'status': 'confirmed', 'pageSize': limit, 'sort': 'occurredAt:desc'},
      cancelToken: cancel,
    );
    return (page['items'] as List).map((t) => TransactionItem.fromJson(t as Map<String, dynamic>)).toList();
  }

  Future<TransactionDetail> transaction(String id, {CancelToken? cancel}) async =>
      TransactionDetail.fromJson(await _client.get<Map<String, dynamic>>('/transactions/$id', cancelToken: cancel));

  Future<Lookups> lookups({CancelToken? cancel}) async {
    final results = await Future.wait([
      _client.get<List<dynamic>>('/accounts', query: {'includeArchived': true}, cancelToken: cancel),
      _client.get<List<dynamic>>('/categories', cancelToken: cancel),
    ]);
    final accounts = results[0].map((a) => AccountRef.fromJson(a as Map<String, dynamic>));
    final categories = results[1].map((c) => CategoryRef.fromJson(c as Map<String, dynamic>));
    return Lookups(accounts: {for (final a in accounts) a.id: a}, categories: {for (final c in categories) c.id: c});
  }
}
