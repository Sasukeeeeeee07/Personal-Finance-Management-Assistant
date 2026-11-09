import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../core/fake_backend.dart';
import '../support/app_harness.dart';
import '../support/fixtures.dart';

/// Widget tests for the MVP management screens, driven through the real app (router, providers,
/// API client) against an in-memory backend that serves real API responses as fixtures.

Map<String, dynamic> createdResponse() {
  final tx = ((fixtureMap('transactions_recent.json')['items'] as List).first as Map<String, dynamic>);
  return {'transaction': tx, 'reservation': null, 'duplicateOf': null, 'budgetAlerts': <dynamic>[], 'idempotentReplay': false};
}

Future<FakeBackend> boot(WidgetTester tester) async {
  tester.view.physicalSize = const Size(500, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final backend = FakeBackend();
  serveDashboard(backend);
  await pumpApp(tester, stored: signedInTokens, backend: backend);
  return backend;
}

Future<void> tab(WidgetTester tester, String label) async {
  await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(label)));
  await tester.pumpAndSettle();
}

Future<void> choose(WidgetTester tester, Key field, String option) async {
  await tester.ensureVisible(find.byKey(field));
  await tester.tap(find.byKey(field));
  await tester.pumpAndSettle();
  await tester.tap(find.textContaining(option).last);
  await tester.pumpAndSettle();
}

Future<void> tapVisible(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('quick add: validates, sends an idempotent expense and refreshes the dashboard', (tester) async {
    final backend = await boot(tester);
    backend.responses['POST /transactions'] = (201, createdResponse());
    await tester.tap(find.byKey(const Key('quickAdd')));
    await tester.pumpAndSettle();
    expect(find.text('Add transaction'), findsOneWidget);

    await tapVisible(tester, find.byKey(const Key('tx.submit')));
    expect(find.text('Enter an amount.'), findsOneWidget);
    expect(find.text('Choose an account.'), findsOneWidget);
    expect(backend.sent('POST', '/transactions'), isEmpty);

    await tester.enterText(find.byKey(const Key('tx.amount')), '1,450.5');
    await choose(tester, const Key('tx.account'), 'HDFC Savings ••4821');
    await tester.enterText(find.byKey(const Key('tx.counterparty')), 'Zomato');
    final summaryCallsBefore = backend.sent('GET', '/dashboard/summary').length;
    await tapVisible(tester, find.byKey(const Key('tx.submit')));

    final post = backend.sent('POST', '/transactions').single;
    final body = post.body as Map;
    expect(body['type'], 'expense');
    expect(body['amount'], '1450.50'); // exact decimal string, never a double
    expect(body['merchant'], 'Zomato');
    expect(post.headers['Idempotency-Key'], matches(RegExp(r'^m-')));
    expect(find.textContaining('Expense saved'), findsOneWidget);
    expect(backend.sent('GET', '/dashboard/summary').length, greaterThan(summaryCallsBefore)); // figures reloaded
  });

  testWidgets('a retry after a server error reuses the same idempotency key; a changed request gets a new one', (tester) async {
    final backend = await boot(tester);
    backend.queued['POST /transactions'] = [
      (500, {'statusCode': 500, 'code': 'internal_error', 'message': 'Something went wrong on our side. Please try again.'}),
      (500, {'statusCode': 500, 'code': 'internal_error', 'message': 'Something went wrong on our side. Please try again.'}),
      (201, createdResponse()),
    ];
    await tester.tap(find.byKey(const Key('quickAdd')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('tx.amount')), '300');
    await choose(tester, const Key('tx.account'), 'HDFC Savings ••4821');
    await tapVisible(tester, find.byKey(const Key('tx.submit')));
    expect(find.text('Something went wrong on our side. Please try again.'), findsOneWidget);
    await tapVisible(tester, find.byKey(const Key('tx.submit'))); // same request again
    await tester.enterText(find.byKey(const Key('tx.amount')), '310');
    await tapVisible(tester, find.byKey(const Key('tx.submit'))); // different request
    final keys = backend.sent('POST', '/transactions').map((r) => r.headers['Idempotency-Key']).toList();
    expect(keys, hasLength(3));
    expect(keys[0], keys[1]);
    expect(keys[2], isNot(keys[0]));
  });

  testWidgets('transfer requires a different destination account and sends no category', (tester) async {
    final backend = await boot(tester);
    backend.responses['POST /transactions'] = (201, createdResponse());
    await tester.tap(find.byKey(const Key('quickAdd')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Transfer'));
    await tester.pumpAndSettle();
    expect(find.textContaining('is not income or spending'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('tx.amount')), '2000');
    await choose(tester, const Key('tx.account'), 'HDFC Savings ••4821');
    await tapVisible(tester, find.byKey(const Key('tx.submit')));
    expect(find.text('Choose the account the money goes to.'), findsOneWidget);
    await choose(tester, const Key('tx.destination'), 'ICICI Amazon Pay ••9012 (card bill payment)');
    await tapVisible(tester, find.byKey(const Key('tx.submit')));
    final body = backend.sent('POST', '/transactions').single.body as Map;
    expect(body['type'], 'transfer');
    expect(body.containsKey('categoryId'), isFalse);
    expect(body['destinationAccountId'], isNotNull);
  });

  testWidgets('Money Lock: paying a reserved bill with a different amount asks first, then settles atomically', (tester) async {
    final backend = await boot(tester);
    final reservation = (fixture('reservations_active.json') as List).cast<Map<String, dynamic>>().firstWhere((r) => r['name'] == 'Electricity');
    backend.queued['POST /transactions'] = [
      (
        409,
        {
          'statusCode': 409,
          'code': 'reservation_amount_mismatch',
          'message': 'You reserved 1400.00 for Electricity but paid 1550.00. Review the difference of 150.00 and confirm.',
          'details': {'difference': '150.00'},
        },
      ),
      (201, createdResponse()),
    ];
    await tab(tester, 'Budget');
    await tester.tap(find.text('Money Lock'));
    await tester.pumpAndSettle();
    expect(find.textContaining('not blocked at your bank'), findsOneWidget);
    // Reservations are listed by due date: Airtel Fiber, Electricity, Rent, Car EMI.
    await tapVisible(tester, find.text('Mark paid').at(1));
    expect(find.text('Pay Electricity'), findsOneWidget);
    expect(find.textContaining('releases the reservation in the same step'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('tx.amount')), '1550');
    await tapVisible(tester, find.byKey(const Key('tx.submit')));
    expect(find.text('Different amount'), findsOneWidget);
    await tester.tap(find.text('Record payment').last);
    await tester.pumpAndSettle();

    final posts = backend.sent('POST', '/transactions');
    expect(posts, hasLength(2));
    final first = posts[0].body as Map;
    final second = posts[1].body as Map;
    expect(first['reservationId'], reservation['id']);
    expect(first.containsKey('acceptReservationDifference'), isFalse);
    expect(second['acceptReservationDifference'], isTrue);
    expect(posts[1].headers['Idempotency-Key'], isNot(posts[0].headers['Idempotency-Key']));
    expect(find.textContaining('Payment saved'), findsOneWidget);
  });

  testWidgets('Money Lock: releasing money needs confirmation; cancelling the dialog sends nothing', (tester) async {
    final backend = await boot(tester);
    await tab(tester, 'Budget');
    await tester.tap(find.text('Money Lock'));
    await tester.pumpAndSettle();
    final card = find.ancestor(of: find.text('Rent'), matching: find.byType(Card)).first;
    await tapVisible(tester, find.descendant(of: card, matching: find.text('Release')));
    expect(find.text('Release Rent?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(backend.requests.where((r) => r.path.endsWith('/release')), isEmpty);
    await tapVisible(tester, find.descendant(of: card, matching: find.text('Release')));
    await tester.tap(find.text('Release money'));
    await tester.pumpAndSettle();
    expect(backend.requests.where((r) => r.method == 'POST' && r.path.endsWith('/release')), hasLength(1));
  });

  testWidgets('transactions tab lists real transactions and filters by type', (tester) async {
    final backend = await boot(tester);
    await tab(tester, 'Transactions');
    final first = ((fixtureMap('transactions_recent.json')['items'] as List).first as Map<String, dynamic>);
    expect(find.text(first['merchant'] as String), findsWidgets);
    await tester.tap(find.widgetWithText(ChoiceChip, 'Income'));
    await tester.pumpAndSettle();
    expect(backend.sent('GET', '/transactions').last.query['type'], 'income');
  });

  testWidgets('deleting a transaction asks for confirmation and sends DELETE', (tester) async {
    final backend = await boot(tester);
    final detail = fixtureMap('transaction_detail.json');
    backend.responses['DELETE /transactions/${detail['id']}'] = (204, null);
    await tab(tester, 'Transactions');
    await tapVisible(tester, find.text(detail['merchant'] as String).first);
    await tester.tap(find.byKey(const Key('tx.delete')));
    await tester.pumpAndSettle();
    expect(find.text('Delete this transaction?'), findsOneWidget);
    expect(find.textContaining('that bill is reserved again'), findsOneWidget);
    await tester.tap(find.text('Delete transaction'));
    await tester.pumpAndSettle();
    expect(backend.sent('DELETE', '/transactions/${detail['id']}'), hasLength(1));
    expect(find.text('Transaction deleted.'), findsOneWidget);
  });

  testWidgets('accounts: grouped list with backend balances; add account validates and posts', (tester) async {
    final backend = await boot(tester);
    backend.responses['POST /accounts'] = (201, (fixture('accounts.json') as List).first);
    await tab(tester, 'Profile');
    await tapVisible(tester, find.text('Accounts'));
    expect(find.text('Spendable money'), findsOneWidget);
    expect(find.text('Credit cards'), findsOneWidget);
    expect(find.text('Savings and deposits'), findsOneWidget);
    expect(find.text('owed'), findsOneWidget);
    await tester.tap(find.text('Add account'));
    await tester.pumpAndSettle();
    await tapVisible(tester, find.byKey(const Key('account.submit')));
    expect(find.text('Enter a name.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('account.name')), 'SBI Savings');
    await tester.enterText(find.byKey(const Key('account.opening')), '25000');
    await tapVisible(tester, find.byKey(const Key('account.submit')));
    final body = backend.sent('POST', '/accounts').single.body as Map;
    expect(body, containsPair('name', 'SBI Savings'));
    expect(body, containsPair('openingBalance', '25000.00'));
    expect(body, containsPair('type', 'savings'));
    expect(body['trackingStartDate'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
  });

  testWidgets('budgets: create an overall monthly budget', (tester) async {
    final backend = await boot(tester);
    await tab(tester, 'Budget');
    expect(find.text('Shopping'), findsWidgets);
    await tester.tap(find.text('Add budget'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('budget.amount')), '30000');
    await tapVisible(tester, find.byKey(const Key('budget.submit')));
    final body = backend.sent('POST', '/budgets').single.body as Map;
    expect(body, containsPair('name', 'All spending'));
    expect(body, containsPair('amount', '30000.00'));
    expect(body, containsPair('period', 'monthly'));
    expect(body.containsKey('categoryId'), isFalse);
  });

  testWidgets('goals: add money is idempotent and refreshes the goal', (tester) async {
    final backend = await boot(tester);
    final goal = fixtureMap('goal_detail.json');
    await tab(tester, 'Goals');
    await tapVisible(tester, find.text(goal['name'] as String));
    await tester.tap(find.byKey(const Key('goal.add')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('goal.move.amount')), '5000');
    await tester.tap(find.text('Add money').last);
    await tester.pumpAndSettle();
    final post = backend.sent('POST', '/goals/${goal['id']}/contributions').single;
    expect(post.body, {'type': 'contribution', 'amount': '5000.00'});
    expect(post.headers['Idempotency-Key'], isNotNull);
    expect(find.textContaining('Added ₹5,000.00'), findsOneWidget);
  });

  testWidgets('reports: shows the backend monthly report', (tester) async {
    await boot(tester);
    final report = fixtureMap('report_monthly.json');
    await tab(tester, 'Profile');
    await tapVisible(tester, find.text('Reports'));
    expect(find.text('Where the money went'), findsOneWidget);
    final top = (report['expensesByCategory'] as List).first as Map<String, dynamic>;
    expect(find.text(top['name'] as String), findsWidgets);
  });
}
