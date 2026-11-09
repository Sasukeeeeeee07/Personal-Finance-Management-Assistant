import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../shared/forms.dart';
import '../../dashboard/data/dashboard_models.dart';
import '../../dashboard/state/dashboard_providers.dart';
import '../../dashboard/ui/dashboard_sections.dart';
import '../../finance/finance_models.dart';
import '../../finance/finance_providers.dart';
import 'transaction_form_screen.dart';

/// All transactions, newest first, with type filters and paging.
class TransactionsScreen extends ConsumerStatefulWidget {
  const TransactionsScreen({super.key, this.accountId, this.title = 'Transactions', this.embedded = false});

  /// When set, shows only this account's transactions (used by the account screen).
  final String? accountId;
  final String title;

  /// Inside another screen (account detail): no app bar of its own.
  final bool embedded;

  @override
  ConsumerState<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends ConsumerState<TransactionsScreen> {
  String? _type;

  TransactionFilter get _filter => TransactionFilter(type: _type, accountId: widget.accountId);

  @override
  Widget build(BuildContext context) {
    final page = ref.watch(transactionsListProvider(_filter));
    final lookups = ref.watch(lookupsProvider).value ?? Lookups.empty;
    return Scaffold(
      appBar: widget.embedded ? null : AppBar(title: Text(widget.title)),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'add-transaction',
        onPressed: () => context.push('/transactions/new', extra: TransactionFormArgs(accountId: widget.accountId)),
        icon: const Icon(Icons.add),
        label: const Text('Add'),
      ),
      body: Column(
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.sm),
            child: Row(
              children: [
                for (final (value, label) in const [(null, 'All'), ('expense', 'Expenses'), ('income', 'Income'), ('transfer', 'Transfers')])
                  Padding(
                    padding: const EdgeInsets.only(right: Space.sm),
                    child: ChoiceChip(label: Text(label), selected: _type == value, onSelected: (_) => setState(() => _type = value)),
                  ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => ref.refresh(transactionsListProvider(_filter).future).then<void>((_) {}, onError: (Object _) {}),
              child: page.when(
                skipLoadingOnRefresh: true,
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (e, _) => ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(Space.xl),
                  children: [
                    Text(userMessage(e), textAlign: TextAlign.center),
                    const SizedBox(height: Space.md),
                    Center(
                      child: FilledButton.tonal(onPressed: () => ref.invalidate(transactionsListProvider(_filter)), child: const Text('Try again')),
                    ),
                  ],
                ),
                data: (p) => _list(context, p, lookups),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _list(BuildContext context, TransactionPage p, Lookups lookups) {
    if (p.items.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(Space.xl),
        children: [
          Icon(Icons.receipt_long_outlined, size: 48, color: Theme.of(context).colorScheme.onSurfaceVariant),
          const SizedBox(height: Space.md),
          Text(
            _type == null ? 'No transactions yet. Tap Add to record income, an expense or a transfer.' : 'Nothing here for this filter.',
            textAlign: TextAlign.center,
          ),
        ],
      );
    }
    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, 96),
      itemCount: p.items.length + 1,
      itemBuilder: (context, i) {
        if (i == p.items.length) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: Space.lg),
            child: Center(
              child: p.hasMore
                  ? OutlinedButton(
                      onPressed: () => ref.read(transactionsListProvider(_filter).notifier).loadMore().catchError((Object e) {
                        if (context.mounted) showMessage(context, userMessage(e), error: true);
                      }),
                      child: Text('Load more (${p.total - p.items.length} left)'),
                    )
                  : Text('${p.total} ${p.total == 1 ? 'transaction' : 'transactions'}', style: Theme.of(context).textTheme.bodySmall),
            ),
          );
        }
        return Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: TransactionRow(tx: p.items[i], lookups: lookups),
          ),
        );
      },
    );
  }
}
