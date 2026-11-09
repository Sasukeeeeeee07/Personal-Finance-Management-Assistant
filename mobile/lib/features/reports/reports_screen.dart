import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/money/money.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/format.dart';
import '../../shared/forms.dart';
import '../dashboard/ui/dashboard_sections.dart';
import '../finance/finance_models.dart';
import '../finance/finance_providers.dart';

/// Monthly report. Every figure, share and comparison is computed by the backend.
class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  late DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);

  String get _key => DateFormat('yyyy-MM').format(_month);
  bool get _isCurrent => _month.year == DateTime.now().year && _month.month == DateTime.now().month;

  @override
  Widget build(BuildContext context) {
    final report = ref.watch(monthlyReportProvider(_key));
    return Scaffold(
      appBar: AppBar(title: const Text('Reports'), leading: backTo(context, '/profile')),
      body: ReadableWidth(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.sm),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    tooltip: 'Previous month',
                    icon: const Icon(Icons.chevron_left),
                    onPressed: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
                  ),
                  SizedBox(
                    width: 160,
                    child: Text(DateFormat('MMMM yyyy').format(_month), textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
                  ),
                  IconButton(
                    tooltip: 'Next month',
                    icon: const Icon(Icons.chevron_right),
                    onPressed: _isCurrent ? null : () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
                  ),
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () => ref.refresh(monthlyReportProvider(_key).future).then<void>((_) {}, onError: (Object _) {}),
                child: report.when(
                  skipLoadingOnRefresh: true,
                  loading: () => const Center(child: CircularProgressIndicator()),
                  error: (e, _) => ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(Space.xl),
                    children: [
                      Text(userMessage(e), textAlign: TextAlign.center),
                      Center(
                        child: TextButton(onPressed: () => ref.invalidate(monthlyReportProvider(_key)), child: const Text('Try again')),
                      ),
                    ],
                  ),
                  data: (r) => _Report(report: r),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Report extends StatelessWidget {
  const _Report({required this.report});

  final MonthlyReport report;

  @override
  Widget build(BuildContext context) {
    final r = report;
    final text = Theme.of(context).textTheme;
    final fc = Theme.of(context).extension<FinanceColors>()!;
    String change(Money m, {required bool spending}) {
      if (m.isZero) return 'same as last month';
      final more = !m.isNegative;
      return '${m.abs().format()} ${more ? 'more' : 'less'} than last month';
    }

    Widget card(String title, List<Widget> children) => Card(
      margin: const EdgeInsets.only(bottom: Space.md),
      child: Padding(
        padding: const EdgeInsets.all(Space.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: text.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: Space.md),
            ...children,
          ],
        ),
      ),
    );

    if (r.income.isZero && r.expenses.isZero) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(Space.xl),
        children: const [Text('No income or expenses recorded for this month.', textAlign: TextAlign.center)],
      );
    }
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(Space.lg),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                card('Summary', [
                  Row(
                    children: [
                      Expanded(
                        child: AmountTile(label: 'Income', amount: r.income, color: fc.positive),
                      ),
                      Expanded(
                        child: AmountTile(label: 'Spent', amount: r.expenses),
                      ),
                      Expanded(
                        child: AmountTile(label: 'Left over', amount: r.net, color: r.net.isNegative ? fc.negative : null),
                      ),
                    ],
                  ),
                  const SizedBox(height: Space.sm),
                  Text(
                    r.savingsRatePercent == null ? 'No income recorded this month.' : 'You kept ${Fmt.percent(r.savingsRatePercent!)} of your income.',
                    style: text.bodyMedium,
                  ),
                  Text('Spending: ${change(r.expensesChange, spending: true)}. Income: ${change(r.incomeChange, spending: false)}.', style: text.bodySmall),
                ]),
                card('Where the money went', [
                  if (r.expensesByCategory.isEmpty) const Text('No expenses this month.'),
                  for (final c in r.expensesByCategory) ...[
                    Row(
                      children: [
                        Expanded(child: Text(c.name)),
                        Text('${c.total.format()} · ${Fmt.percent(c.sharePercent)}'),
                      ],
                    ),
                    const SizedBox(height: Space.xs),
                    Semantics(
                      value: '${Fmt.percent(c.sharePercent)} of spending',
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(Radii.sm),
                        child: LinearProgressIndicator(value: Fmt.fraction(c.sharePercent), minHeight: 6),
                      ),
                    ),
                    const SizedBox(height: Space.md),
                  ],
                ]),
                card('Kind of spending', [
                  Row(
                    children: [
                      Expanded(
                        child: AmountTile(label: 'Essential', amount: r.essential),
                      ),
                      Expanded(
                        child: AmountTile(label: 'Non-essential', amount: r.nonEssential),
                      ),
                    ],
                  ),
                  const SizedBox(height: Space.md),
                  Row(
                    children: [
                      Expanded(
                        child: AmountTile(label: 'Planned', amount: r.planned),
                      ),
                      Expanded(
                        child: AmountTile(label: 'Unplanned', amount: r.unplanned),
                      ),
                    ],
                  ),
                ]),
                if (r.largestExpenses.isNotEmpty)
                  card('Largest expenses', [
                    for (final (label, amount, category, at) in r.largestExpenses)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(label),
                        subtitle: Text([?category, Fmt.shortDate(at)].join(' · ')),
                        trailing: Text(amount.format(), style: const TextStyle(fontWeight: FontWeight.w600)),
                      ),
                  ]),
                if (r.incomeByCategory.isNotEmpty)
                  card('Income sources', [
                    for (final c in r.incomeByCategory)
                      Row(
                        children: [
                          Expanded(child: Text(c.name)),
                          Text(c.total.format()),
                        ],
                      ),
                  ]),
                for (final n in r.notes) Text('• $n', style: text.bodySmall),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
