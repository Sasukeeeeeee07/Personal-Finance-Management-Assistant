import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../shared/format.dart';
import '../../dashboard/data/dashboard_models.dart';
import '../../dashboard/state/dashboard_providers.dart';
import '../../dashboard/ui/dashboard_sections.dart';
import '../../dashboard/ui/section_card.dart';

/// Read-only transaction details (opened from the dashboard). Editing arrives with the
/// Transactions module.
class TransactionDetailScreen extends ConsumerWidget {
  const TransactionDetailScreen({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(transactionDetailProvider(id));
    final lookups = ref.watch(lookupsProvider).value ?? Lookups.empty;
    return Scaffold(
      appBar: AppBar(title: const Text('Transaction')),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(transactionDetailProvider(id).future).then<void>((_) {}, onError: (Object _) {}),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(Space.lg),
          children: [
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 640),
                child: switch (detail) {
                  AsyncData(:final value) => _Details(d: value, lookups: lookups),
                  AsyncError(:final error) => Column(
                    children: [
                      const SizedBox(height: Space.xxl),
                      Text(friendlyError(error), textAlign: TextAlign.center),
                      const SizedBox(height: Space.md),
                      FilledButton.tonal(onPressed: () => ref.invalidate(transactionDetailProvider(id)), child: const Text('Try again')),
                    ],
                  ),
                  _ => const Padding(
                    padding: EdgeInsets.only(top: Space.xxl),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Details extends StatelessWidget {
  const _Details({required this.d, required this.lookups});

  final TransactionDetail d;
  final Lookups lookups;

  @override
  Widget build(BuildContext context) {
    final t = d.item;
    final text = Theme.of(context).textTheme;
    final fc = Theme.of(context).extension<FinanceColors>()!;
    final category = t.categoryId == null ? null : lookups.categories[t.categoryId]?.name;
    final typeLabel = switch (t.type) {
      'income' => 'Income',
      'expense' => 'Expense',
      _ => 'Transfer',
    };
    final sign = t.isIncome
        ? '+'
        : t.isExpense
        ? '−'
        : '';
    final rows = <(String, String)>[
      ('Type', typeLabel),
      if (category != null) ('Category', category),
      if (t.merchant != null) ('Merchant', t.merchant!),
      if (t.sourceName != null) ('From', t.sourceName!),
      ('Account', lookups.accounts[t.accountId]?.label ?? '—'),
      if (t.destinationAccountId != null) ('To account', lookups.accounts[t.destinationAccountId]?.label ?? '—'),
      ('Date', Fmt.dateTime(t.occurredAt)),
      if (d.paymentMethod != null) ('Payment method', d.paymentMethod!),
      if (d.externalReference != null) ('Reference', d.externalReference!),
      if (t.description != null) ('Description', t.description!),
      if (d.notes != null) ('Notes', d.notes!),
      (
        'Recorded from',
        switch (t.source) {
          'manual' => 'Manual entry',
          'sms' => 'SMS',
          'notification' => 'Notification',
          'statement_import' => 'Statement import',
          _ => 'Account aggregator',
        },
      ),
    ];
    final flags = [
      if (d.isPlanned == true) 'Planned',
      if (d.isPlanned == false) 'Unplanned',
      if (d.isEssential == true) 'Essential',
      if (d.isEssential == false) 'Non-essential',
      if (d.isRecurring) 'Recurring',
      if (t.isHistorical) 'Historical import',
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          label: '$typeLabel of ${t.amount.format()}',
          excludeSemantics: true,
          child: Column(
            children: [
              Text(t.counterparty ?? category ?? typeLabel, style: text.titleMedium, textAlign: TextAlign.center),
              const SizedBox(height: Space.xs),
              Text(
                '$sign${t.amount.format()}',
                style: text.displaySmall?.copyWith(fontWeight: FontWeight.w700, color: t.isIncome ? fc.positive : null),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
        if (flags.isNotEmpty) ...[
          const SizedBox(height: Space.md),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: Space.sm,
            runSpacing: Space.sm,
            children: [for (final f in flags) Chip(label: Text(f), visualDensity: VisualDensity.compact)],
          ),
        ],
        const SizedBox(height: Space.xl),
        Card(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.sm),
            child: Column(
              children: [
                for (final (label, value) in rows)
                  MergeSemantics(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: Space.sm),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: 130,
                            child: Text(label, style: text.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                          ),
                          Expanded(child: Text(value, style: text.bodyMedium)),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        if (d.insight != null) ...[
          const SizedBox(height: Space.lg),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(Space.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('${category ?? 'Category'} spending', style: text.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: Space.md),
                  Row(
                    children: [
                      Expanded(
                        child: AmountTile(label: 'This month', amount: d.insight!.spentThisMonth),
                      ),
                      Expanded(
                        child: AmountTile(label: 'Last month', amount: d.insight!.spentLastMonth),
                      ),
                    ],
                  ),
                  const SizedBox(height: Space.sm),
                  Text(
                    d.insight!.changeFromLastMonth.isZero
                        ? 'Same as last month so far.'
                        : d.insight!.changeFromLastMonth.isNegative
                        ? '${d.insight!.changeFromLastMonth.abs().format()} less than last month so far.'
                        : '${d.insight!.changeFromLastMonth.format()} more than last month so far.',
                  ),
                  if (d.insight!.budget != null) ...[
                    const Divider(height: Space.xl),
                    BudgetBar(
                      label: '${d.insight!.budget!.name} budget',
                      spent: d.insight!.budget!.spent,
                      limit: d.insight!.budget!.limit,
                      remaining: d.insight!.budget!.remaining,
                      percent: d.insight!.budget!.utilizationPercent,
                      health: d.insight!.budget!.health,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}
