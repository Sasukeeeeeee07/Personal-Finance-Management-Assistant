import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/money/money.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/format.dart';
import '../../shared/forms.dart';
import '../../shared/widgets.dart';
import '../finance/finance_models.dart';
import '../finance/finance_providers.dart';
import '../transactions/ui/transaction_form_screen.dart';
import '../transactions/ui/transactions_screen.dart';

/// Accounts grouped by kind. Balances are exactly what the backend's ledger reports.
class AccountsScreen extends ConsumerWidget {
  const AccountsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accounts = ref.watch(accountsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Accounts')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'add-account',
        onPressed: () => context.push('/accounts/new'),
        icon: const Icon(Icons.add),
        label: const Text('Add account'),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(accountsProvider.future).then<void>((_) {}, onError: (Object _) {}),
        child: accounts.when(
          skipLoadingOnRefresh: true,
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => _Retry(message: userMessage(e), onRetry: () => ref.invalidate(accountsProvider)),
          data: (list) {
            if (list.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(Space.xl),
                children: const [
                  Icon(Icons.account_balance_outlined, size: 48),
                  SizedBox(height: Space.md),
                  Text(
                    'No accounts yet. Add your bank accounts, cash, wallets and credit cards with their current balances to start tracking.',
                    textAlign: TextAlign.center,
                  ),
                ],
              );
            }
            final active = list.where((a) => !a.archived).toList();
            final groups = <(String, List<Account>)>[
              ('Spendable money', active.where((a) => a.isLiquid).toList()),
              ('Credit cards', active.where((a) => a.isLiability).toList()),
              ('Savings and deposits', active.where((a) => !a.isLiquid && !a.isLiability).toList()),
              ('Archived', list.where((a) => a.archived).toList()),
            ];
            return ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.lg, 96),
              children: [
                for (final (title, items) in groups)
                  if (items.isNotEmpty) ...[
                    Padding(
                      padding: const EdgeInsets.only(top: Space.lg, bottom: Space.sm),
                      child: Text(title, style: Theme.of(context).textTheme.titleSmall),
                    ),
                    Card(
                      child: Column(children: [for (final a in items) _AccountTile(account: a)]),
                    ),
                  ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _AccountTile extends StatelessWidget {
  const _AccountTile({required this.account});

  final Account account;

  @override
  Widget build(BuildContext context) {
    final fc = Theme.of(context).extension<FinanceColors>()!;
    final a = account;
    final owed = a.isLiability ? a.outstanding ?? Money.zero : null;
    return ListTile(
      leading: CircleAvatar(child: Icon(_icon(a.type), size: 20)),
      title: Text(a.label),
      subtitle: Text([a.typeLabel, ?a.institutionName].join(' · ')),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            owed != null ? owed.format() : a.balance.format(),
            style: TextStyle(fontWeight: FontWeight.w600, color: owed != null && !owed.isZero ? fc.warning : (a.balance.isNegative ? fc.negative : null)),
          ),
          if (owed != null) Text('owed', style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
      onTap: () => context.push('/accounts/${a.id}'),
    );
  }
}

IconData _icon(String type) => switch (type) {
  'cash' => Icons.payments_outlined,
  'wallet' => Icons.account_balance_wallet_outlined,
  'credit_card' => Icons.credit_card,
  'fixed_deposit' => Icons.savings_outlined,
  _ => Icons.account_balance_outlined,
};

class _Retry extends StatelessWidget {
  const _Retry({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => ListView(
    physics: const AlwaysScrollableScrollPhysics(),
    padding: const EdgeInsets.all(Space.xl),
    children: [
      Text(message, textAlign: TextAlign.center),
      const SizedBox(height: Space.md),
      Center(
        child: FilledButton.tonal(onPressed: onRetry, child: const Text('Try again')),
      ),
    ],
  );
}

// --- add account ----------------------------------------------------------------------------------

class AccountFormScreen extends ConsumerStatefulWidget {
  const AccountFormScreen({super.key});

  @override
  ConsumerState<AccountFormScreen> createState() => _AccountFormScreenState();
}

class _AccountFormScreenState extends ConsumerState<AccountFormScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _institution = TextEditingController();
  final _mask = TextEditingController();
  final _opening = TextEditingController(text: '0');
  final _limit = TextEditingController();
  String _type = 'savings';
  String _trackingStart = ymd(DateTime.now());
  bool _busy = false;
  String? _error;
  Map<String, String> _fieldErrors = const {};

  bool get _card => _type == 'credit_card';

  @override
  void dispose() {
    for (final c in [_name, _institution, _mask, _opening, _limit]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _fieldErrors = const {});
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(financeApiProvider).createAccount({
        'name': _name.text.trim(),
        'type': _type,
        'openingBalance': moneyForApi(_opening.text),
        'trackingStartDate': _trackingStart,
        if (_institution.text.trim().isNotEmpty) 'institutionName': _institution.text.trim(),
        if (_mask.text.trim().isNotEmpty) 'accountMask': _mask.text.trim(),
        if (_card && _limit.text.trim().isNotEmpty) 'creditLimit': moneyForApi(_limit.text),
      });
      refreshFinancialData(ref);
      if (!mounted) return;
      showMessage(context, 'Account added.');
      context.pop();
    } on ApiError catch (e) {
      setState(() {
        _fieldErrors = {for (final entry in e.fields.entries) entry.key: entry.value.join(' ')};
        _error = e.fields.isEmpty ? e.message : 'Some fields need attention.';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: Space.lg);
    return Scaffold(
      appBar: AppBar(title: const Text('Add account')),
      body: Form(
        key: _form,
        child: FormBody(
          children: [
            if (_error != null) ...[MessageBanner(message: _error!), gap],
            SelectField<String>(
              key: const Key('account.type'),
              label: 'Type',
              value: _type,
              items: [for (final e in accountTypeLabels.entries) (e.key, e.value)],
              onChanged: (v) => setState(() => _type = v ?? 'savings'),
            ),
            gap,
            AppTextField(
              key: const Key('account.name'),
              label: 'Name',
              hint: 'e.g. HDFC Savings',
              controller: _name,
              validator: (v) => v.trim().isEmpty ? 'Enter a name.' : null,
              serverError: _fieldErrors['name'],
              enabled: !_busy,
            ),
            gap,
            AppTextField(label: 'Bank or provider (optional)', controller: _institution, enabled: !_busy),
            gap,
            AppTextField(
              label: 'Last 4 digits (optional)',
              helper: 'Never enter a full account or card number.',
              controller: _mask,
              keyboardType: TextInputType.number,
              validator: (v) => v.isEmpty || RegExp(r'^\d{2,4}$').hasMatch(v) ? null : 'Enter only the last 2–4 digits.',
              serverError: _fieldErrors['accountMask'],
              enabled: !_busy,
            ),
            gap,
            AppTextField(
              key: const Key('account.opening'),
              label: _card ? 'Amount you owe now (₹)' : 'Current balance (₹)',
              helper: _card ? 'Enter 0 if the card is fully paid.' : 'What the account holds on the tracking start date.',
              controller: _opening,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              validator: (v) => moneyValidator(v, allowZero: true, label: 'a balance'),
              serverError: _fieldErrors['openingBalance'],
              enabled: !_busy,
            ),
            if (_card) ...[
              gap,
              AppTextField(
                label: 'Credit limit (optional, ₹)',
                controller: _limit,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                validator: (v) => v.trim().isEmpty ? null : moneyValidator(v, label: 'a limit'),
                enabled: !_busy,
              ),
            ],
            gap,
            DateField(
              label: 'Tracking starts on',
              helper: 'Transactions before this date are already part of the balance above.',
              value: _trackingStart,
              last: DateTime.now(),
              onChanged: (d) => setState(() => _trackingStart = d),
            ),
            const SizedBox(height: Space.xl),
            PrimaryButton(key: const Key('account.submit'), label: 'Add account', busy: _busy, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}

// --- account detail -------------------------------------------------------------------------------

class AccountDetailScreen extends ConsumerWidget {
  const AccountDetailScreen({super.key, required this.id});

  final String id;

  Future<void> _reconcile(BuildContext context, WidgetRef ref, Account a) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Check against your bank'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(labelText: a.isLiability ? 'Amount owed per the card statement (₹)' : 'Balance your bank shows (₹)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, controller.text), child: const Text('Compare')),
        ],
      ),
    );
    if (value == null || !context.mounted) return;
    if (moneyValidator(value, allowZero: true) != null) {
      showMessage(context, 'Enter an amount like 2500 or 2500.50.', error: true);
      return;
    }
    try {
      final r = await ref.read(financeApiProvider).reconcile(a.id, moneyForApi(value));
      if (context.mounted) showMessage(context, r['hint'] as String);
    } catch (e) {
      if (context.mounted) showMessage(context, userMessage(e), error: true);
    }
  }

  Future<void> _toggleArchive(BuildContext context, WidgetRef ref, Account a) async {
    if (!a.archived) {
      final ok = await confirmAction(
        context,
        title: 'Archive ${a.name}?',
        message: 'It disappears from pickers and from available-to-spend. Its history stays in your reports. You can unarchive it later.',
        confirmLabel: 'Archive account',
      );
      if (!ok || !context.mounted) return;
    }
    try {
      await ref.read(financeApiProvider).updateAccount(a.id, {'archived': !a.archived});
      refreshFinancialData(ref);
      if (context.mounted) showMessage(context, a.archived ? 'Account restored.' : 'Account archived.');
    } catch (e) {
      if (context.mounted) showMessage(context, userMessage(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accounts = ref.watch(accountsProvider);
    final a = accounts.value?.where((x) => x.id == id).firstOrNull;
    if (a == null) {
      return Scaffold(
        appBar: AppBar(),
        body: accounts.isLoading ? const Center(child: CircularProgressIndicator()) : const Center(child: Text('Account not found.')),
      );
    }
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(a.name),
        actions: [
          IconButton(
            tooltip: a.archived ? 'Unarchive' : 'Archive',
            icon: Icon(a.archived ? Icons.unarchive_outlined : Icons.archive_outlined),
            onPressed: () => _toggleArchive(context, ref, a),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(Space.lg),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(Space.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(a.isLiability ? 'Amount owed' : 'Balance', style: text.bodyMedium),
                    Text(
                      a.isLiability ? (a.outstanding ?? Money.zero).format() : a.balance.format(),
                      style: text.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    if (a.availableCredit != null) Text('Available credit ${a.availableCredit!.format()}', style: text.bodySmall),
                    Text('${a.typeLabel} · tracked since ${Fmt.day(a.trackingStartDate)}', style: text.bodySmall),
                    const SizedBox(height: Space.md),
                    Wrap(
                      spacing: Space.sm,
                      runSpacing: Space.sm,
                      children: [
                        if (!a.archived)
                          FilledButton.tonalIcon(
                            onPressed: () => context.push(
                              '/transactions/new',
                              extra: TransactionFormArgs(type: 'transfer', accountId: a.isLiability ? null : a.id),
                            ),
                            icon: const Icon(Icons.swap_horiz),
                            label: Text(a.isLiability ? 'Pay card bill' : 'Transfer'),
                          ),
                        OutlinedButton.icon(
                          onPressed: () => _reconcile(context, ref, a),
                          icon: const Icon(Icons.fact_check_outlined),
                          label: const Text('Check against bank'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(child: TransactionsScreen(accountId: a.id, embedded: true)),
        ],
      ),
    );
  }
}
