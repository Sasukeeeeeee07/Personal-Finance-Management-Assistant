import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/format.dart';
import '../../shared/forms.dart';
import '../../shared/widgets.dart';
import '../dashboard/data/dashboard_models.dart';
import '../dashboard/state/dashboard_providers.dart';
import '../dashboard/ui/dashboard_sections.dart';
import '../finance/finance_models.dart';
import '../finance/finance_providers.dart';
import '../transactions/ui/transaction_form_screen.dart';

/// Budget tab: spending limits and Money Lock (money set aside for upcoming bills).
class PlanScreen extends ConsumerStatefulWidget {
  const PlanScreen({super.key});

  @override
  ConsumerState<PlanScreen> createState() => _PlanScreenState();
}

class _PlanScreenState extends ConsumerState<PlanScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this)..addListener(() => setState(() {}));

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final onLock = _tabs.index == 1;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Budget'),
        bottom: TabBar(
          controller: _tabs,
          tabs: const [
            Tab(text: 'Budgets'),
            Tab(text: 'Money Lock'),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'plan-add',
        onPressed: () => context.push(onLock ? '/money-lock/new' : '/budgets/new'),
        icon: const Icon(Icons.add),
        label: Text(onLock ? 'Add commitment' : 'Add budget'),
      ),
      body: TabBarView(controller: _tabs, children: const [_BudgetsTab(), _MoneyLockTab()]),
    );
  }
}

Widget _retry(String message, VoidCallback onRetry) => ListView(
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

Widget _empty(BuildContext context, IconData icon, String text) => ListView(
  physics: const AlwaysScrollableScrollPhysics(),
  padding: const EdgeInsets.all(Space.xl),
  children: [
    Icon(icon, size: 48, color: Theme.of(context).colorScheme.onSurfaceVariant),
    const SizedBox(height: Space.md),
    Text(text, textAlign: TextAlign.center),
  ],
);

// --- budgets --------------------------------------------------------------------------------------

class _BudgetsTab extends ConsumerWidget {
  const _BudgetsTab();

  Future<void> _edit(BuildContext context, WidgetRef ref, BudgetStatus b) async {
    final amount = TextEditingController(text: b.limit.toApi());
    final formKey = GlobalKey<FormState>();
    final action = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Edit ${b.name}'),
        content: Form(
          key: formKey,
          child: TextFormField(
            controller: amount,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Budget amount (₹)'),
            validator: (v) => moneyValidator(v ?? ''),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, 'archive'), child: const Text('Archive budget')),
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (formKey.currentState!.validate()) Navigator.pop(ctx, 'save');
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (action == null || !context.mounted) return;
    final api = ref.read(financeApiProvider);
    try {
      if (action == 'archive') {
        final ok = await confirmAction(
          context,
          title: 'Archive ${b.name}?',
          message: 'The budget stops tracking from now on. Your spending history is not affected.',
          confirmLabel: 'Archive budget',
        );
        if (!ok) return;
        await api.archiveBudget(b.id);
      } else {
        await api.updateBudget(b.id, {'amount': moneyForApi(amount.text)});
      }
      refreshFinancialData(ref);
      if (context.mounted) showMessage(context, action == 'archive' ? 'Budget archived.' : 'Budget updated.');
    } catch (e) {
      if (context.mounted) showMessage(context, userMessage(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final budgets = ref.watch(budgetsProvider);
    final categories = ref.watch(lookupsProvider).value?.categories ?? const {};
    return RefreshIndicator(
      onRefresh: () => ref.refresh(budgetsProvider.future).then<void>((_) {}, onError: (Object _) {}),
      child: budgets.when(
        skipLoadingOnRefresh: true,
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _retry(userMessage(e), () => ref.invalidate(budgetsProvider)),
        data: (list) {
          if (list.isEmpty) {
            return _empty(context, Icons.donut_large_outlined, 'No budgets yet. Set an overall monthly limit, or limits for categories like Food or Shopping.');
          }
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(Space.lg, Space.lg, Space.lg, 96),
            children: [
              for (final b in list)
                Padding(
                  padding: const EdgeInsets.only(bottom: Space.md),
                  child: Card(
                    child: InkWell(
                      borderRadius: BorderRadius.circular(Radii.lg),
                      onTap: () => _edit(context, ref, b),
                      child: Padding(
                        padding: const EdgeInsets.all(Space.lg),
                        child: BudgetBar(
                          label: b.isOverall ? '${b.name} (overall)' : (categories[b.categoryId]?.name ?? b.name),
                          spent: b.spent,
                          limit: b.limit,
                          remaining: b.remaining,
                          percent: b.utilizationPercent,
                          health: b.health,
                          subtitle: '${b.period == 'monthly' ? 'Monthly' : (b.period == 'weekly' ? 'Weekly' : 'Custom')} · ${b.daysLeft}d left',
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class BudgetFormScreen extends ConsumerStatefulWidget {
  const BudgetFormScreen({super.key});

  @override
  ConsumerState<BudgetFormScreen> createState() => _BudgetFormScreenState();
}

class _BudgetFormScreenState extends ConsumerState<BudgetFormScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _amount = TextEditingController();
  final _days = TextEditingController(text: '14');
  String? _categoryId;
  String _period = 'monthly';
  String _start = '${ymd(DateTime.now()).substring(0, 7)}-01';
  bool _rollover = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _amount.dispose();
    _days.dispose();
    super.dispose();
  }

  Future<void> _submit(Map<String, CategoryRef> categories) async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final name = _name.text.trim().isNotEmpty ? _name.text.trim() : (_categoryId == null ? 'All spending' : categories[_categoryId]!.name);
    try {
      await ref.read(financeApiProvider).createBudget({
        'name': name,
        'period': _period,
        'amount': moneyForApi(_amount.text),
        'startDate': _start,
        'rollover': _rollover,
        'categoryId': ?_categoryId,
        if (_period == 'custom') 'periodDays': int.parse(_days.text),
      });
      refreshFinancialData(ref);
      if (!mounted) return;
      showMessage(context, 'Budget created.');
      context.pop();
    } on ApiError catch (e) {
      setState(() => _error = e.fields.isEmpty ? e.message : e.fields.values.expand((m) => m).join(' '));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lookups = ref.watch(lookupsProvider).value ?? Lookups.empty;
    final cats = categoriesOf(lookups, 'expense');
    const gap = SizedBox(height: Space.lg);
    return Scaffold(
      appBar: AppBar(title: const Text('Add budget')),
      body: Form(
        key: _form,
        child: FormBody(
          children: [
            if (_error != null) ...[MessageBanner(message: _error!), gap],
            SelectField<String?>(
              key: const Key('budget.category'),
              label: 'What it covers',
              value: _categoryId,
              items: [(null, 'All spending (overall limit)'), for (final c in cats) (c.id, c.name)],
              onChanged: (v) => setState(() => _categoryId = v),
            ),
            gap,
            AppTextField(label: 'Name (optional)', hint: 'Defaults to the category name', controller: _name, enabled: !_busy),
            gap,
            AppTextField(
              key: const Key('budget.amount'),
              label: 'Limit (₹)',
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              validator: (v) => moneyValidator(v, label: 'a limit'),
              enabled: !_busy,
            ),
            gap,
            SelectField<String>(
              label: 'Resets',
              value: _period,
              items: const [('monthly', 'Every month'), ('weekly', 'Every week'), ('custom', 'Every N days')],
              onChanged: (v) => setState(() => _period = v ?? 'monthly'),
            ),
            if (_period == 'custom') ...[
              gap,
              AppTextField(
                label: 'Days in each period',
                controller: _days,
                keyboardType: TextInputType.number,
                validator: (v) {
                  final n = int.tryParse(v);
                  return n == null || n < 1 || n > 366 ? 'Enter a number from 1 to 366.' : null;
                },
              ),
            ],
            gap,
            DateField(
              label: 'First period starts',
              helper: _period == 'monthly' ? 'Resets on this day each month (e.g. your salary day).' : null,
              value: _start,
              onChanged: (d) => setState(() => _start = d),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Carry unused amount forward'),
              subtitle: const Text('What you don’t spend this period is added to the next one.'),
              value: _rollover,
              onChanged: (v) => setState(() => _rollover = v),
            ),
            const SizedBox(height: Space.xl),
            PrimaryButton(key: const Key('budget.submit'), label: 'Create budget', busy: _busy, onPressed: () => _submit(lookups.categories)),
          ],
        ),
      ),
    );
  }
}

// --- Money Lock -----------------------------------------------------------------------------------

class _MoneyLockTab extends ConsumerWidget {
  const _MoneyLockTab();

  Future<void> _adjust(BuildContext context, WidgetRef ref, Reservation r) async {
    final c = TextEditingController(text: r.reservedAmount.toApi());
    final formKey = GlobalKey<FormState>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Set aside for ${r.name}'),
        content: Form(
          key: formKey,
          child: TextFormField(
            controller: c,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: 'Amount reserved (₹)', helperText: 'Up to ${r.targetAmount.format()}'),
            // Format only; the backend enforces "no more than the bill amount" and its message is shown.
            validator: (v) => moneyValidator(v ?? '', allowZero: true),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (formKey.currentState!.validate()) Navigator.pop(ctx, true);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await ref.read(financeApiProvider).adjustReservation(r.id, moneyForApi(c.text));
      refreshFinancialData(ref);
      if (context.mounted) showMessage(context, 'Reserved amount updated.');
    } catch (e) {
      if (context.mounted) showMessage(context, userMessage(e), error: true);
    }
  }

  Future<void> _release(BuildContext context, WidgetRef ref, Reservation r) async {
    final ok = await confirmAction(
      context,
      title: 'Release ${r.name}?',
      message:
          'The ${r.reservedAmount.format()} set aside goes back to available-to-spend. Use this when the bill was waived or you will not pay it. Recurring commitments move on to the next due date.',
      confirmLabel: 'Release money',
    );
    if (!ok || !context.mounted) return;
    try {
      await ref.read(financeApiProvider).releaseReservation(r.id);
      refreshFinancialData(ref);
      if (context.mounted) showMessage(context, 'Released ${r.reservedAmount.format()}.');
    } catch (e) {
      if (context.mounted) showMessage(context, userMessage(e), error: true);
    }
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref, Commitment c) async {
    final ok = await confirmAction(
      context,
      title: 'Cancel ${c.name}?',
      message: 'No more reservations will be made for it, and the money currently set aside is released. Past payments are not affected.',
      confirmLabel: 'Cancel commitment',
    );
    if (!ok || !context.mounted) return;
    try {
      await ref.read(financeApiProvider).cancelCommitment(c.id);
      refreshFinancialData(ref);
      if (context.mounted) showMessage(context, '${c.name} cancelled.');
    } catch (e) {
      if (context.mounted) showMessage(context, userMessage(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reservations = ref.watch(activeReservationsProvider);
    final commitments = ref.watch(commitmentsProvider);
    final summary = ref.watch(dashboardSummaryProvider).value;
    final accounts = {for (final a in ref.watch(accountsProvider).value ?? const <Account>[]) a.id: a};
    final fc = Theme.of(context).extension<FinanceColors>()!;
    final text = Theme.of(context).textTheme;
    Future<void> refresh() async {
      ref.invalidate(commitmentsProvider);
      ref.invalidate(dashboardSummaryProvider);
      await ref.refresh(activeReservationsProvider.future).then<void>((_) {}, onError: (Object _) {});
    }

    return RefreshIndicator(
      onRefresh: refresh,
      child: reservations.when(
        skipLoadingOnRefresh: true,
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _retry(userMessage(e), () => ref.invalidate(activeReservationsProvider)),
        data: (list) {
          final commitmentList = commitments.value ?? const <Commitment>[];
          if (list.isEmpty && commitmentList.isEmpty) {
            return _empty(
              context,
              Icons.lock_clock_outlined,
              'Nothing reserved yet. Add rent, EMIs and bills as commitments — their money is set aside before you spend, so available-to-spend stays honest.',
            );
          }
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(Space.lg, Space.lg, Space.lg, 96),
            children: [
              if (summary != null)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(Space.lg),
                    child: Row(
                      children: [
                        Expanded(
                          child: AmountTile(label: 'Reserved for bills', amount: summary.reserved, emphasis: true),
                        ),
                        Expanded(
                          child: AmountTile(label: 'Available to spend', amount: summary.availableToSpend, emphasis: true),
                        ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: Space.sm),
              Text('Reserved money is planned inside this app — it is not blocked at your bank.', style: text.bodySmall),
              const SizedBox(height: Space.lg),
              Text('Upcoming payments', style: text.titleMedium),
              const SizedBox(height: Space.sm),
              if (list.isEmpty) const Text('No open reservations.'),
              for (final r in list)
                Card(
                  margin: const EdgeInsets.only(bottom: Space.sm),
                  child: Padding(
                    padding: const EdgeInsets.all(Space.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(r.name, style: text.titleSmall),
                                  Text(
                                    '${Fmt.dueLabel(r.dueDate, summary?.asOf ?? ymd(DateTime.now()))} · ${Fmt.day(r.dueDate)} · ${accounts[r.accountId]?.name ?? ''}',
                                    style: text.bodySmall?.copyWith(color: r.overdue ? fc.negative : null),
                                  ),
                                ],
                              ),
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(r.targetAmount.format(), style: text.titleSmall),
                                Text(r.fullyReserved ? 'Fully reserved' : '${r.reservedAmount.format()} reserved', style: text.bodySmall),
                              ],
                            ),
                          ],
                        ),
                        const SizedBox(height: Space.sm),
                        Wrap(
                          spacing: Space.sm,
                          children: [
                            FilledButton.tonal(
                              onPressed: () => context.push('/transactions/new', extra: TransactionFormArgs(payReservation: r)),
                              child: const Text('Mark paid'),
                            ),
                            TextButton(onPressed: () => _adjust(context, ref, r), child: const Text('Change amount')),
                            TextButton(onPressed: () => _release(context, ref, r), child: const Text('Release')),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: Space.lg),
              Text('Commitments', style: text.titleMedium),
              const SizedBox(height: Space.sm),
              for (final c in commitmentList)
                Card(
                  margin: const EdgeInsets.only(bottom: Space.sm),
                  child: ListTile(
                    title: Text(c.name),
                    subtitle: Text('${c.amount.format()} · ${c.frequencyLabel} · next ${Fmt.day(c.nextDueDate)}'),
                    trailing: IconButton(tooltip: 'Cancel commitment', icon: const Icon(Icons.close), onPressed: () => _cancel(context, ref, c)),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class CommitmentFormScreen extends ConsumerStatefulWidget {
  const CommitmentFormScreen({super.key});

  @override
  ConsumerState<CommitmentFormScreen> createState() => _CommitmentFormScreenState();
}

class _CommitmentFormScreenState extends ConsumerState<CommitmentFormScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _amount = TextEditingController();
  final _reserve = TextEditingController();
  final _interval = TextEditingController(text: '1');
  String? _accountId;
  String? _categoryId;
  String _frequency = 'monthly';
  String _due = ymd(DateTime.now().add(const Duration(days: 7)));
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_name, _amount, _reserve, _interval]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(financeApiProvider).createCommitment({
        'name': _name.text.trim(),
        'amount': moneyForApi(_amount.text),
        'accountId': _accountId,
        'frequency': _frequency,
        'intervalCount': int.parse(_interval.text),
        'dueDate': _due,
        'categoryId': ?_categoryId,
        if (_reserve.text.trim().isNotEmpty) 'reserveAmount': moneyForApi(_reserve.text),
      });
      refreshFinancialData(ref);
      if (!mounted) return;
      showMessage(context, '${_name.text.trim()} added and money reserved.');
      context.pop();
    } on ApiError catch (e) {
      setState(() => _error = e.fields.isEmpty ? e.message : e.fields.values.expand((m) => m).join(' '));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final accounts = (ref.watch(accountsProvider).value ?? const <Account>[]).where((a) => !a.archived).toList();
    final cats = categoriesOf(ref.watch(lookupsProvider).value ?? Lookups.empty, 'expense');
    const gap = SizedBox(height: Space.lg);
    return Scaffold(
      appBar: AppBar(title: const Text('Add commitment')),
      body: Form(
        key: _form,
        child: FormBody(
          children: [
            const MessageBanner(
              tone: BannerTone.info,
              message: 'Rent, EMIs, bills and subscriptions. The amount is reserved now, so available-to-spend already excludes it.',
            ),
            gap,
            if (_error != null) ...[MessageBanner(message: _error!), gap],
            AppTextField(
              key: const Key('commitment.name'),
              label: 'Name',
              hint: 'e.g. Rent',
              controller: _name,
              validator: (v) => v.trim().isEmpty ? 'Enter a name.' : null,
              enabled: !_busy,
            ),
            gap,
            AppTextField(
              key: const Key('commitment.amount'),
              label: 'Amount (₹)',
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              validator: (v) => moneyValidator(v),
              enabled: !_busy,
            ),
            gap,
            SelectField<String>(
              key: const Key('commitment.account'),
              label: 'Paid from',
              value: _accountId,
              items: [for (final a in accounts) (a.id, a.label)],
              onChanged: (v) => setState(() => _accountId = v),
              validator: (v) => v == null ? 'Choose an account.' : null,
            ),
            gap,
            SelectField<String?>(
              label: 'Category (optional)',
              value: _categoryId,
              items: [(null, 'No category'), for (final c in cats) (c.id, c.name)],
              onChanged: (v) => setState(() => _categoryId = v),
            ),
            gap,
            SelectField<String>(
              label: 'Repeats',
              value: _frequency,
              items: const [('monthly', 'Monthly'), ('weekly', 'Weekly'), ('yearly', 'Yearly'), ('custom_days', 'Every N days'), ('once', 'Only once')],
              onChanged: (v) => setState(() => _frequency = v ?? 'monthly'),
            ),
            if (_frequency != 'once') ...[
              gap,
              AppTextField(
                label: _frequency == 'custom_days' ? 'Every how many days' : 'Every how many periods',
                controller: _interval,
                keyboardType: TextInputType.number,
                validator: (v) {
                  final n = int.tryParse(v);
                  return n == null || n < 1 || n > 366 ? 'Enter a number from 1 to 366.' : null;
                },
              ),
            ],
            gap,
            DateField(label: 'Next due date', value: _due, onChanged: (d) => setState(() => _due = d)),
            gap,
            AppTextField(
              label: 'Reserve now (optional, ₹)',
              helper: 'Leave empty to reserve the full amount. Less than the amount = partial reservation.',
              controller: _reserve,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              validator: (v) => v.trim().isEmpty ? null : moneyValidator(v, allowZero: true),
              enabled: !_busy,
            ),
            const SizedBox(height: Space.xl),
            PrimaryButton(key: const Key('commitment.submit'), label: 'Add and reserve', busy: _busy, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}
