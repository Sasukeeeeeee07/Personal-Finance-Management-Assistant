import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/money/money.dart';

import '../core/fake_backend.dart';
import '../support/app_harness.dart';
import '../support/fixtures.dart';

String money(String raw) => Money.fromApi(raw).format();

void main() {
  late Map<String, dynamic> summary;
  late Map<String, dynamic> forecast;

  setUp(() {
    summary = fixtureMap('dashboard_summary.json');
    forecast = fixtureMap('forecast.json');
  });

  Future<void> scrollTo(WidgetTester tester, Finder f) async {
    await tester.scrollUntilVisible(f, 300, scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
  }

  testWidgets('shows every section with the backend figures as received', (tester) async {
    final (backend, _) = await pumpApp(tester, stored: signedInTokens);

    // 1. Financial summary
    expect(find.text('Available to spend'), findsOneWidget);
    expect(find.text(money(summary['availableToSpend'] as String)), findsWidgets); // hero + forecast 'Available now'
    expect(find.text(money(summary['liquidBalance'] as String)), findsOneWidget);
    expect(find.text(money(summary['netPosition'] as String)), findsOneWidget);
    expect(find.textContaining('You owe ${money(summary['creditCardOutstanding'] as String)} on credit cards'), findsOneWidget);

    // 2. Budgets: overall + category progress with warnings
    await scrollTo(tester, find.text('All spending (overall)'));
    expect(find.text('Food'), findsWidgets);
    expect(find.textContaining('Over by'), findsWidgets); // the exceeded Shopping budget

    // 3. Money Lock
    await scrollTo(tester, find.text('Airtel Fiber'));
    expect(find.text('Rent'), findsOneWidget);
    expect(find.textContaining('Overdue by 2 days'), findsOneWidget);
    expect(find.text('1 overdue'), findsOneWidget);

    // 4. Forecast with comparison to available money now
    await scrollTo(tester, find.textContaining('Expected balance on'));
    expect(find.text(money(forecast['estimatedMonthEndBalance'] as String)), findsOneWidget);
    expect(find.textContaining('confidence'), findsOneWidget);
    expect(find.textContaining('than you can spend now'), findsOneWidget);

    // 5. Recent transactions
    await scrollTo(tester, find.text('Recent transactions'));
    final recent = (fixtureMap('transactions_recent.json')['items'] as List).first as Map<String, dynamic>;
    await scrollTo(tester, find.text(recent['merchant'] as String? ?? 'Transfer to Paytm Wallet').first);

    // Read-only dashboard: only GETs were sent.
    expect(backend.log.where((l) => !l.startsWith('GET ')), isEmpty);
  });

  testWidgets('explains the available-to-spend calculation using the backend notes', (tester) async {
    await pumpApp(tester, stored: signedInTokens);
    await tester.tap(find.text('How this is worked out'));
    await tester.pumpAndSettle();
    expect(find.text('How available-to-spend is worked out'), findsOneWidget);
    expect(find.textContaining('not blocked or frozen at your bank'), findsOneWidget);
  });

  testWidgets('a brand-new account shows helpful empty states', (tester) async {
    await pumpApp(tester, stored: signedInTokens, emptyDashboard: true);
    expect(find.text(money('0.00')), findsWidgets);
    await scrollTo(tester, find.textContaining('No budgets yet'));
    await scrollTo(tester, find.textContaining('No upcoming commitments'));
    await scrollTo(tester, find.textContaining('No transactions yet'));
    expect(find.textContaining('You owe'), findsNothing);
  });

  testWidgets('one failing section does not blank the others, and can be retried', (tester) async {
    final backend = FakeBackend();
    serveDashboard(backend);
    backend.responses['/forecast/month-end'] = (
      500,
      {'statusCode': 500, 'code': 'internal_error', 'message': 'Something went wrong on our side. Please try again.'},
    );
    await pumpApp(tester, stored: signedInTokens, backend: backend);
    expect(find.text('Available to spend'), findsOneWidget);
    await scrollTo(tester, find.text('Something went wrong on our side. Please try again.'));
    backend.responses['/forecast/month-end'] = (200, forecast);
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.textContaining('Expected balance on'));
  });

  testWidgets('pull-to-refresh while offline keeps the last figures and says so', (tester) async {
    final (backend, _) = await pumpApp(tester, stored: signedInTokens);
    final before = backend.log.where((l) => l == 'GET /dashboard/summary').length;
    backend.offline = true;
    await tester.fling(find.byType(Scrollable).first, const Offset(0, 500), 1500);
    await tester.pumpAndSettle();
    expect(backend.log.where((l) => l == 'GET /dashboard/summary').length, before + 1); // it did try
    expect(find.text('You’re offline. Pull down or tap Refresh to try again when you’re connected.'), findsOneWidget);
    expect(find.text(money(summary['availableToSpend'] as String)), findsWidgets); // hero + forecast 'Available now' // still shown
    expect(find.text('Offline — showing the last figures loaded.'), findsWidgets);

    backend.offline = false;
    await tester.fling(find.byType(Scrollable).first, const Offset(0, 500), 1500);
    await tester.pumpAndSettle();
    expect(find.text('Offline — showing the last figures loaded.'), findsNothing);
  });

  testWidgets('the Refresh button reloads every section (for mouse, keyboard and screen-reader users)', (tester) async {
    final (backend, _) = await pumpApp(tester, stored: signedInTokens);
    final before = backend.log.length;
    await tester.tap(find.byTooltip('Refresh'));
    await tester.pumpAndSettle();
    final calls = backend.log.sublist(before);
    for (final path in ['/dashboard/summary', '/budgets', '/forecast/month-end', '/transactions', '/accounts', '/categories']) {
      expect(calls, contains('GET $path'));
    }
  });

  testWidgets('tapping a recent transaction opens its details', (tester) async {
    final backend = FakeBackend();
    serveDashboard(backend);
    final detail = fixtureMap('transaction_detail.json');
    // Put the fixture detail first in the recent list so it is the one tapped.
    final list = fixtureMap('transactions_recent.json');
    final items = (list['items'] as List).cast<Map<String, dynamic>>();
    backend.responses['/transactions'] = (
      200,
      {
        ...list,
        'items': [items.firstWhere((t) => t['id'] == detail['id']), ...items.where((t) => t['id'] != detail['id'])],
      },
    );
    await pumpApp(tester, stored: signedInTokens, backend: backend);
    final row = find.text(detail['merchant'] as String).first;
    await scrollTo(tester, row);
    await tester.tap(row);
    await tester.pumpAndSettle();
    expect(find.text('Transaction'), findsOneWidget);
    expect(find.text('−${money(detail['amount'] as String)}'), findsOneWidget);
    expect(find.textContaining('spending'), findsOneWidget); // category insight from the API
    expect(backend.log, contains('GET /transactions/${detail['id']}'));
  });

  testWidgets('dark theme and a wide layout render without errors', (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await pumpApp(tester, stored: signedInTokens);
    expect(find.byType(NavigationRail), findsOneWidget); // wide: rail instead of bottom bar
    expect(find.text('Available to spend'), findsOneWidget);
    expect(find.text('Month-end forecast'), findsOneWidget); // two columns: visible without scrolling
    expect(Theme.of(tester.element(find.text('Available to spend'))).brightness, Brightness.dark);
  });

  testWidgets('meets tap-target and labelling guidelines', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpApp(tester, stored: signedInTokens);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    expect(find.bySemanticsLabel(RegExp('^Available to spend: ₹')), findsOneWidget);
    handle.dispose();
  });
}
