import 'dart:convert';
import 'dart:io';

import '../core/fake_backend.dart';

/// Real API responses captured from the backend by `backend/scripts/demo-data.ts` and validated
/// against the frozen OpenAPI contract by `backend/test/response-contract.e2e-spec.ts`.
dynamic fixture(String name) => jsonDecode(File('test/fixtures/$name').readAsStringSync());

Map<String, dynamic> fixtureMap(String name) => fixture(name) as Map<String, dynamic>;

/// Serves every dashboard endpoint from fixtures. [empty] uses the brand-new-account variants.
void serveDashboard(FakeBackend backend, {bool empty = false}) {
  if (empty) {
    backend.responses['/dashboard/summary'] = (200, fixture('dashboard_summary_empty.json'));
    backend.responses['/forecast/month-end'] = (200, fixture('forecast_empty.json'));
    backend.responses['/budgets'] = (200, <dynamic>[]);
    backend.responses['GET /transactions'] = (200, {'items': <dynamic>[], 'page': 1, 'pageSize': 5, 'total': 0, 'sort': 'occurredAt:desc'});
    backend.responses['GET /accounts'] = (200, <dynamic>[]);
  } else {
    backend.responses['/dashboard/summary'] = (200, fixture('dashboard_summary.json'));
    backend.responses['/forecast/month-end'] = (200, fixture('forecast.json'));
    backend.responses['/budgets'] = (200, fixture('budgets.json'));
    backend.responses['GET /transactions'] = (200, fixture('transactions_recent.json'));
    backend.responses['GET /accounts'] = (200, fixture('accounts.json'));
    final detail = fixtureMap('transaction_detail.json');
    backend.responses['/transactions/${detail['id']}'] = (200, detail);
  }
  backend.responses['/categories'] = (200, fixture('categories.json'));
  backend.responses['GET /commitments'] = (200, empty ? <dynamic>[] : fixture('commitments.json'));
  backend.responses['GET /reservations'] = (200, empty ? <dynamic>[] : fixture('reservations_active.json'));
  backend.responses['GET /goals'] = (200, empty ? <dynamic>[] : fixture('goals.json'));
  backend.responses['GET /reports/monthly'] = (200, fixture('report_monthly.json'));
  if (!empty) {
    final goal = fixtureMap('goal_detail.json');
    backend.responses['GET /goals/${goal['id']}'] = (200, goal);
  }
}
