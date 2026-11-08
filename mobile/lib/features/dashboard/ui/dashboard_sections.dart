import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/money/money.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/format.dart';
import '../data/dashboard_models.dart';

FinanceColors _fc(BuildContext c) => Theme.of(c).extension<FinanceColors>()!;

/// A labelled amount, read as one phrase by screen readers.
class AmountTile extends StatelessWidget {
  const AmountTile({super.key, required this.label, required this.amount, this.caption, this.color, this.emphasis = false});

  final String label;
  final Money amount;
  final String? caption;
  final Color? color;
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return MergeSemantics(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: text.bodySmall?.copyWith(color: muted)),
          const SizedBox(height: 2),
          Text(
            amount.format(),
            style: (emphasis ? text.titleLarge : text.titleMedium)?.copyWith(fontWeight: FontWeight.w600, color: color),
          ),
          if (caption != null) Text(caption!, style: text.bodySmall?.copyWith(color: muted)),
        ],
      ),
    );
  }
}

// --- 1. Financial summary -----------------------------------------------------------------------

class AvailableHero extends StatelessWidget {
  const AvailableHero({super.key, required this.summary});

  final DashboardSummary summary;

  void _explain(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(Space.xl, 0, Space.xl, Space.xl),
          children: [
            Text('How available-to-spend is worked out', style: Theme.of(ctx).textTheme.titleMedium),
            const SizedBox(height: Space.md),
            for (final note in summary.calculationNotes)
              Padding(
                padding: const EdgeInsets.only(bottom: Space.sm),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('•  '),
                    Expanded(child: Text(note)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final onHero = scheme.onPrimaryContainer;
    return Card(
      color: scheme.primaryContainer,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.lg)),
      child: Padding(
        padding: const EdgeInsets.all(Space.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              label: 'Available to spend: ${summary.availableToSpend.format()}',
              excludeSemantics: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Available to spend', style: text.titleSmall?.copyWith(color: onHero)),
                  const SizedBox(height: Space.xs),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(
                      summary.availableToSpend.format(),
                      style: text.displaySmall?.copyWith(color: onHero, fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ),
            if (summary.overcommitted) ...[
              const SizedBox(height: Space.sm),
              Row(
                children: [
                  Icon(Icons.warning_amber_rounded, size: 18, color: scheme.error),
                  const SizedBox(width: Space.xs),
                  Expanded(
                    child: Text(
                      'Your commitments are more than the money you have.',
                      style: text.bodyMedium?.copyWith(color: onHero, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: Space.lg),
            _HeroRow(label: 'Liquid balance', amount: summary.liquidBalance, color: onHero),
            _HeroRow(label: 'Reserved for bills', amount: summary.reserved, color: onHero, minus: true),
            _HeroRow(label: 'Set aside for goals', amount: summary.allocated, color: onHero, minus: true),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                style: TextButton.styleFrom(foregroundColor: onHero, padding: EdgeInsets.zero),
                onPressed: () => _explain(context),
                icon: const Icon(Icons.info_outline, size: 18),
                label: const Text('How this is worked out'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HeroRow extends StatelessWidget {
  const _HeroRow({required this.label, required this.amount, required this.color, this.minus = false});

  final String label;
  final Money amount;
  final Color color;
  final bool minus;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyMedium?.copyWith(color: color);
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          children: [
            Expanded(child: Text(minus ? '− $label' : label, style: style)),
            Text(amount.format(), style: style?.copyWith(fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}

class MoneyOverview extends StatelessWidget {
  const MoneyOverview({super.key, required this.summary});

  final DashboardSummary summary;

  @override
  Widget build(BuildContext context) {
    final fc = _fc(context);
    final hasCardDues = !summary.creditCardOutstanding.isZero;
    final tiles = <Widget>[
      AmountTile(label: 'Total balance', amount: summary.totalBalance, caption: 'All accounts incl. deposits'),
      AmountTile(label: 'Net position', amount: summary.netPosition, caption: 'After card dues', color: summary.netPosition.isNegative ? fc.negative : null),
      AmountTile(label: 'Savings in goals', amount: summary.savings),
      AmountTile(label: 'Card dues', amount: summary.creditCardOutstanding, color: hasCardDues ? fc.warning : null),
      AmountTile(label: 'Income this month', amount: summary.monthIncome, color: fc.positive),
      AmountTile(label: 'Spent this month', amount: summary.monthExpenses),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, c) {
            final columns = c.maxWidth >= 480 ? 3 : 2;
            final width = (c.maxWidth - Space.lg * (columns - 1)) / columns;
            return Wrap(
              spacing: Space.lg,
              runSpacing: Space.lg,
              children: [for (final t in tiles) SizedBox(width: width, child: t)],
            );
          },
        ),
        if (hasCardDues) ...[
          const SizedBox(height: Space.lg),
          // Review decision D-006: unreserved card dues are shown prominently and are not subtracted automatically.
          Container(
            padding: const EdgeInsets.all(Space.md),
            decoration: BoxDecoration(color: fc.warning.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(Radii.md)),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.credit_card, size: 20, color: fc.warning),
                const SizedBox(width: Space.sm),
                Expanded(
                  child: Text(
                    'You owe ${summary.creditCardOutstanding.format()} on credit cards. It isn’t taken out of available-to-spend — reserve money for the bill with a commitment.',
                  ),
                ),
              ],
            ),
          ),
        ],
        if (summary.needsReviewCount > 0) ...[
          const SizedBox(height: Space.md),
          Text(
            '${summary.needsReviewCount} ${summary.needsReviewCount == 1 ? 'transaction needs' : 'transactions need'} your review. They aren’t counted until you confirm them.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ],
    );
  }
}

// --- 2. Budgets ---------------------------------------------------------------------------------

class BudgetBar extends StatelessWidget {
  const BudgetBar({
    super.key,
    required this.label,
    required this.spent,
    required this.limit,
    required this.remaining,
    required this.percent,
    required this.health,
    this.subtitle,
  });

  final String label;
  final Money spent;
  final Money limit;
  final Money remaining;
  final String percent;
  final BudgetHealth health;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final fc = _fc(context);
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final color = switch (health) {
      BudgetHealth.exceeded => fc.negative,
      BudgetHealth.warning => fc.warning,
      BudgetHealth.onTrack => scheme.primary,
    };
    final status = switch (health) {
      BudgetHealth.exceeded => 'Over by ${remaining.abs().format()}',
      BudgetHealth.warning => '${remaining.format()} left · ${Fmt.percent(percent)} used',
      BudgetHealth.onTrack => '${remaining.format()} left',
    };
    return MergeSemantics(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(label, style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w500)),
              ),
              Text('${spent.format(decimals: false)} of ${limit.format(decimals: false)}', style: text.bodyMedium),
            ],
          ),
          const SizedBox(height: Space.xs),
          Semantics(
            value: '${Fmt.percent(percent)} used',
            child: ClipRRect(
              borderRadius: BorderRadius.circular(Radii.sm),
              child: LinearProgressIndicator(value: Fmt.fraction(percent), minHeight: 8, color: color, backgroundColor: scheme.surfaceContainerHighest),
            ),
          ),
          const SizedBox(height: Space.xs),
          Row(
            children: [
              if (health != BudgetHealth.onTrack) ...[
                Icon(health == BudgetHealth.exceeded ? Icons.error_outline : Icons.warning_amber_rounded, size: 16, color: color),
                const SizedBox(width: Space.xs),
              ],
              Expanded(
                child: Text(status, style: text.bodySmall?.copyWith(color: health == BudgetHealth.onTrack ? scheme.onSurfaceVariant : color)),
              ),
              if (subtitle != null) Text(subtitle!, style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
            ],
          ),
        ],
      ),
    );
  }
}

class BudgetOverview extends StatelessWidget {
  const BudgetOverview({super.key, required this.budgets, required this.categories});

  final List<BudgetStatus> budgets;
  final Map<String, CategoryRef> categories;

  @override
  Widget build(BuildContext context) {
    if (budgets.isEmpty) {
      return const _Empty(icon: Icons.donut_large_outlined, text: 'No budgets yet. Budgets you create will show your spending against each limit here.');
    }
    // Overall monthly first, then other overall budgets, then categories — most stretched first.
    final overall = budgets.where((b) => b.isOverall).toList();
    final categoryBudgets = budgets.where((b) => !b.isOverall).toList()..sort((a, b) => b.health.index.compareTo(a.health.index));
    String nameOf(BudgetStatus b) => b.categoryId != null ? (categories[b.categoryId]?.name ?? b.name) : b.name;
    String periodOf(BudgetStatus b) => switch (b.period) {
      'monthly' => '${b.daysLeft} ${b.daysLeft == 1 ? 'day' : 'days'} left',
      'weekly' => 'This week',
      _ => 'This period',
    };
    final rows = [...overall, ...categoryBudgets];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < rows.length; i++) ...[
          BudgetBar(
            label: rows[i].isOverall ? '${nameOf(rows[i])} (overall)' : nameOf(rows[i]),
            spent: rows[i].spent,
            limit: rows[i].limit,
            remaining: rows[i].remaining,
            percent: rows[i].utilizationPercent,
            health: rows[i].health,
            subtitle: periodOf(rows[i]),
          ),
          if (rows[i].isOverall && rows[i].health != BudgetHealth.exceeded && !rows[i].dailyTarget.isZero)
            Padding(
              padding: const EdgeInsets.only(top: Space.xs),
              child: Text('About ${rows[i].dailyTarget.format()} a day keeps you within budget.', style: Theme.of(context).textTheme.bodySmall),
            ),
          if (i < rows.length - 1) const Divider(height: Space.xl),
        ],
      ],
    );
  }
}

// --- 3. Money Lock ------------------------------------------------------------------------------

class MoneyLockOverview extends StatelessWidget {
  const MoneyLockOverview({super.key, required this.summary});

  final DashboardSummary summary;

  @override
  Widget build(BuildContext context) {
    final payments = summary.upcomingPayments;
    if (payments.isEmpty) {
      return const _Empty(
        icon: Icons.lock_clock_outlined,
        text: 'No upcoming commitments. Rent, EMIs and bills you add will be reserved here before they’re due.',
      );
    }
    final fc = _fc(context);
    final text = Theme.of(context).textTheme;
    final overdue = payments.where((p) => p.overdue).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('${summary.reserved.format()} reserved for upcoming payments. This money is planned, not blocked at your bank.', style: text.bodySmall),
        if (overdue > 0) ...[
          const SizedBox(height: Space.sm),
          Row(
            children: [
              Icon(Icons.error_outline, size: 18, color: fc.negative),
              const SizedBox(width: Space.xs),
              Text(
                '$overdue overdue',
                style: text.bodyMedium?.copyWith(color: fc.negative, fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ],
        const SizedBox(height: Space.sm),
        for (final p in payments)
          MergeSemantics(
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(
                backgroundColor: p.overdue ? fc.negative.withValues(alpha: 0.15) : fc.reserved.withValues(alpha: 0.15),
                child: Icon(p.overdue ? Icons.event_busy : Icons.event, color: p.overdue ? fc.negative : fc.reserved, size: 20),
              ),
              title: Text(p.name),
              subtitle: Text(
                '${Fmt.dueLabel(p.dueDate, summary.asOf)} · ${Fmt.day(p.dueDate, relativeTo: summary.asOf)}',
                style: TextStyle(color: p.overdue ? fc.negative : null),
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(p.amount.format(), style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                  Text(p.fullyReserved ? 'Fully reserved' : '${p.reserved.format(decimals: false)} reserved', style: text.bodySmall),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

// --- 4. Forecast --------------------------------------------------------------------------------

class ForecastOverview extends StatelessWidget {
  const ForecastOverview({super.key, required this.forecast});

  final Forecast forecast;

  @override
  Widget build(BuildContext context) {
    final fc = _fc(context);
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final change = forecast.availableChangeByMonthEnd;
    final changeText = change.isZero
        ? 'about the same as you can spend now'
        : change.isNegative
        ? '${change.abs().format()} less than you can spend now'
        : '${change.format()} more than you can spend now';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: AmountTile(
                label: 'Expected balance on ${Fmt.day(forecast.monthEnd)}',
                amount: forecast.estimatedMonthEndBalance,
                emphasis: true,
                color: forecast.shortfallRisk ? fc.negative : null,
              ),
            ),
            Chip(
              label: Text('${forecast.confidence[0].toUpperCase()}${forecast.confidence.substring(1)} confidence'),
              visualDensity: VisualDensity.compact,
              side: BorderSide(color: scheme.outlineVariant),
            ),
          ],
        ),
        const SizedBox(height: Space.md),
        Row(
          children: [
            Expanded(
              child: AmountTile(label: 'Available now', amount: forecast.availableNow),
            ),
            Expanded(
              child: AmountTile(label: 'Available at month end', amount: forecast.estimatedAvailableAtMonthEnd),
            ),
          ],
        ),
        const SizedBox(height: Space.sm),
        Text('That’s $changeText.', style: text.bodyMedium?.copyWith(color: change.isNegative ? fc.warning : null)),
        if (forecast.shortfallRisk) ...[
          const SizedBox(height: Space.sm),
          Text(
            'At this pace you may run short before the month ends.',
            style: text.bodyMedium?.copyWith(color: fc.negative, fontWeight: FontWeight.w600),
          ),
        ],
        Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            tilePadding: EdgeInsets.zero,
            childrenPadding: const EdgeInsets.only(bottom: Space.sm),
            title: Text('Assumptions (${forecast.assumptions.length})', style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
            children: [
              // The same terms, in the same order, as the backend formula, so the lines add up.
              _ForecastLine(label: 'Liquid balance now', amount: forecast.startingLiquidBalance, plain: true),
              _ForecastLine(label: 'Expected income', amount: forecast.expectedIncome),
              _ForecastLine(label: 'Scheduled payments', amount: forecast.scheduledPayments, minus: true),
              _ForecastLine(label: 'Recurring expenses', amount: forecast.recurringExpenses, minus: true),
              _ForecastLine(label: 'Day-to-day spending', amount: forecast.variableSpending, minus: true),
              const Divider(),
              _ForecastLine(label: 'Expected month-end balance', amount: forecast.estimatedMonthEndBalance, plain: true, bold: true),
              const SizedBox(height: Space.sm),
              for (final a in forecast.assumptions)
                Padding(
                  padding: const EdgeInsets.only(bottom: Space.xs),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('•  '),
                      Expanded(child: Text(a, style: text.bodySmall)),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ForecastLine extends StatelessWidget {
  const _ForecastLine({required this.label, required this.amount, this.minus = false, this.plain = false, this.bold = false});

  final String label;
  final Money amount;
  final bool minus;
  final bool plain;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = bold ? const TextStyle(fontWeight: FontWeight.w600) : null;
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 1),
        child: Row(
          children: [
            Expanded(child: Text(plain ? label : (minus ? '− $label' : '+ $label'), style: style)),
            Text(amount.format(), style: style),
          ],
        ),
      ),
    );
  }
}

// --- 5. Recent transactions ---------------------------------------------------------------------

class TransactionRow extends StatelessWidget {
  const TransactionRow({super.key, required this.tx, required this.lookups});

  final TransactionItem tx;
  final Lookups lookups;

  @override
  Widget build(BuildContext context) {
    final fc = _fc(context);
    final scheme = Theme.of(context).colorScheme;
    final category = tx.categoryId == null ? null : lookups.categories[tx.categoryId]?.name;
    final account = lookups.accounts[tx.accountId]?.name;
    final title = tx.isTransfer
        ? 'Transfer to ${lookups.accounts[tx.destinationAccountId]?.name ?? 'account'}'
        : (tx.counterparty ?? category ?? (tx.isIncome ? 'Income' : 'Expense'));
    final meta = [if (!tx.isTransfer && category != null && category != title) category, Fmt.shortDate(tx.occurredAt), ?account].join(' · ');
    final (icon, color, sign) = tx.isIncome
        ? (Icons.south_west, fc.positive, '+')
        : tx.isExpense
        ? (Icons.north_east, scheme.onSurface, '−')
        : (Icons.swap_horiz, scheme.onSurfaceVariant, '');
    return MergeSemantics(
      child: ListTile(
        contentPadding: EdgeInsets.zero,
        leading: CircleAvatar(
          backgroundColor: scheme.surfaceContainerHighest,
          child: Icon(icon, size: 20, color: color),
        ),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(meta, maxLines: 1, overflow: TextOverflow.ellipsis),
        trailing: Text(
          '$sign${tx.amount.format()}',
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600, color: tx.isIncome ? fc.positive : null),
        ),
        onTap: () => context.push('/transactions/${tx.id}'),
      ),
    );
  }
}

class RecentTransactions extends StatelessWidget {
  const RecentTransactions({super.key, required this.items, required this.lookups});

  final List<TransactionItem> items;
  final Lookups lookups;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const _Empty(icon: Icons.receipt_long_outlined, text: 'No transactions yet. Income and expenses you record will appear here.');
    }
    return Column(
      children: [for (final t in items) TransactionRow(tx: t, lookups: lookups)],
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: muted),
        const SizedBox(width: Space.md),
        Expanded(
          child: Text(text, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: muted)),
        ),
      ],
    );
  }
}
