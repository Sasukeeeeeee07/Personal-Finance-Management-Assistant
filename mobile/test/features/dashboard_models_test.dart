import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/money/money.dart';
import 'package:pfm_mobile/features/dashboard/data/dashboard_models.dart';

import '../support/fixtures.dart';

void main() {
  test('parses the dashboard summary exactly as returned by the API', () {
    final raw = fixtureMap('dashboard_summary.json');
    final s = DashboardSummary.fromJson(raw);
    for (final (field, value) in [
      ('availableToSpend', s.availableToSpend),
      ('liquidBalance', s.liquidBalance),
      ('reserved', s.reserved),
      ('allocated', s.allocated),
      ('netPosition', s.netPosition),
      ('creditCardOutstanding', s.creditCardOutstanding),
      ('totalBalance', s.totalBalance),
      ('savings', s.savings),
    ]) {
      // The app keeps the backend's exact decimal string: no rounding, no recomputation.
      expect(value.toApi(), raw[field], reason: field);
    }
    expect(s.upcomingPayments, isNotEmpty);
    expect(s.upcomingPayments.any((p) => p.overdue), isTrue);
    expect(s.monthlyBudget, isNotNull);
  });

  test('parses empty-account responses (nulls and empty lists)', () {
    final s = DashboardSummary.fromJson(fixtureMap('dashboard_summary_empty.json'));
    expect(s.monthlyBudget, isNull);
    expect(s.upcomingPayments, isEmpty);
    expect(s.availableToSpend, Money.zero);
    final f = Forecast.fromJson(fixtureMap('forecast_empty.json'));
    expect(f.assumptions, isNotEmpty);
  });

  test('parses budgets, forecast, transactions, detail, accounts and categories', () {
    final budgets = (fixture('budgets.json') as List).map((b) => BudgetStatus.fromJson(b as Json)).toList();
    expect(budgets.map((b) => b.health), containsAll([BudgetHealth.exceeded, BudgetHealth.warning]));
    final f = Forecast.fromJson(fixtureMap('forecast.json'));
    expect(f.availableNow.toApi(), fixtureMap('forecast.json')['availableNow']);
    final list = (fixtureMap('transactions_recent.json')['items'] as List).map((t) => TransactionItem.fromJson(t as Json)).toList();
    expect(list, hasLength(5));
    final detail = TransactionDetail.fromJson(fixtureMap('transaction_detail.json'));
    expect(detail.insight, isNotNull);
    final accounts = (fixture('accounts.json') as List).map((a) => AccountRef.fromJson(a as Json));
    expect(accounts.firstWhere((a) => a.type == 'credit_card').outstanding, isNotNull);
    final cats = (fixture('categories.json') as List).map((c) => CategoryRef.fromJson(c as Json));
    expect(cats.map((c) => c.name), contains('Food'));
  });

  test('the forecast breakdown shown to users adds up to the backend estimate', () {
    // Arithmetic here only checks consistency of the figures the app displays; the app itself never adds them.
    final f = Forecast.fromJson(fixtureMap('forecast.json'));
    final lines = f.startingLiquidBalance + f.expectedIncome - f.scheduledPayments - f.recurringExpenses - f.variableSpending;
    expect(lines, f.estimatedMonthEndBalance);
  });

  test('rejects money that is not a 2-decimal string', () {
    final raw = {...fixtureMap('dashboard_summary.json'), 'availableToSpend': 121711.0};
    expect(() => DashboardSummary.fromJson(raw), throwsA(isA<TypeError>()));
    final bad = {...fixtureMap('dashboard_summary.json'), 'availableToSpend': '1e5'};
    expect(() => DashboardSummary.fromJson(bad), throwsFormatException);
  });
}
