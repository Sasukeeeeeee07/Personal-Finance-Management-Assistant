import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../../core/money/money.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/format.dart';
import '../../shared/forms.dart';
import '../../shared/widgets.dart';
import '../dashboard/ui/dashboard_sections.dart';
import '../finance/finance_models.dart';
import '../finance/finance_providers.dart';

const _allocationHelp =
    'Track only: progress is recorded; available-to-spend is unchanged.\nSet aside: the saved money is subtracted from available-to-spend so you don’t spend it by accident.';

class GoalsScreen extends ConsumerWidget {
  const GoalsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final goals = ref.watch(goalsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Goals')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'add-goal',
        onPressed: () => context.push('/goals/new'),
        icon: const Icon(Icons.add),
        label: const Text('Add goal'),
      ),
      body: ReadableWidth(
        child: RefreshIndicator(
          onRefresh: () => ref.refresh(goalsProvider.future).then<void>((_) {}, onError: (Object _) {}),
          child: goals.when(
            skipLoadingOnRefresh: true,
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(Space.xl),
              children: [
                Text(userMessage(e), textAlign: TextAlign.center),
                Center(
                  child: TextButton(onPressed: () => ref.invalidate(goalsProvider), child: const Text('Try again')),
                ),
              ],
            ),
            data: (list) => list.isEmpty
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(Space.xl),
                    children: const [
                      Icon(Icons.flag_outlined, size: 48),
                      SizedBox(height: Space.md),
                      Text('No goals yet. Add an emergency fund, a trip or anything you are saving for.', textAlign: TextAlign.center),
                    ],
                  )
                : ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(Space.lg, Space.lg, Space.lg, 96),
                    children: [for (final g in list) _GoalCard(goal: g)],
                  ),
          ),
        ),
      ),
    );
  }
}

class _GoalCard extends StatelessWidget {
  const _GoalCard({required this.goal});

  final Goal goal;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final g = goal;
    return Card(
      margin: const EdgeInsets.only(bottom: Space.md),
      child: InkWell(
        borderRadius: BorderRadius.circular(Radii.lg),
        onTap: () => context.push('/goals/${g.id}'),
        child: Padding(
          padding: const EdgeInsets.all(Space.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text(g.name, style: text.titleMedium)),
                  if (g.status == 'completed') const Chip(label: Text('Reached'), visualDensity: VisualDensity.compact),
                  if (g.reserves) const Chip(label: Text('Set aside'), visualDensity: VisualDensity.compact),
                ],
              ),
              const SizedBox(height: Space.sm),
              Semantics(
                value: '${Fmt.percent(g.progressPercent)} saved',
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(Radii.sm),
                  child: LinearProgressIndicator(value: Fmt.fraction(g.progressPercent), minHeight: 8),
                ),
              ),
              const SizedBox(height: Space.xs),
              Text('${g.saved.format()} of ${g.targetAmount.format()} · ${Fmt.percent(g.progressPercent)}', style: text.bodyMedium),
              if (g.recommendedMonthly != null && g.targetDate != null)
                Text('Save ${g.recommendedMonthly!.format()} a month to reach it by ${Fmt.day(g.targetDate!)}.', style: text.bodySmall)
              else if (g.estimatedCompletionDate != null && g.status != 'completed')
                Text('At this pace: reached around ${Fmt.day(g.estimatedCompletionDate!)}.', style: text.bodySmall),
            ],
          ),
        ),
      ),
    );
  }
}

class GoalFormScreen extends ConsumerStatefulWidget {
  const GoalFormScreen({super.key});

  @override
  ConsumerState<GoalFormScreen> createState() => _GoalFormScreenState();
}

class _GoalFormScreenState extends ConsumerState<GoalFormScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _target = TextEditingController();
  final _monthly = TextEditingController();
  final _initial = TextEditingController();
  String _kind = 'savings';
  String? _targetDate;
  int _priority = 2;
  String _mode = 'track_only';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_name, _target, _monthly, _initial]) {
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
      await ref.read(financeApiProvider).createGoal({
        'name': _name.text.trim(),
        'kind': _kind,
        'targetAmount': moneyForApi(_target.text),
        'priority': _priority,
        'allocationMode': _mode,
        'targetDate': ?_targetDate,
        if (_monthly.text.trim().isNotEmpty) 'monthlyContribution': moneyForApi(_monthly.text),
        if (_initial.text.trim().isNotEmpty) 'initialAmount': moneyForApi(_initial.text),
      });
      refreshFinancialData(ref);
      if (!mounted) return;
      showMessage(context, 'Goal added.');
      leave(context, '/goals');
    } on ApiError catch (e) {
      setState(() => _error = e.fields.isEmpty ? e.message : e.fields.values.expand((m) => m).join(' '));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: Space.lg);
    return Scaffold(
      appBar: AppBar(title: const Text('Add goal'), leading: backTo(context, '/goals')),
      body: Form(
        key: _form,
        child: FormBody(
          children: [
            if (_error != null) ...[MessageBanner(message: _error!), gap],
            AppTextField(
              key: const Key('goal.name'),
              label: 'Goal',
              hint: 'e.g. Emergency fund',
              controller: _name,
              validator: (v) => v.trim().isEmpty ? 'Enter a name.' : null,
              enabled: !_busy,
            ),
            gap,
            SelectField<String>(
              label: 'Kind',
              value: _kind,
              items: [for (final e in goalKindLabels.entries) (e.key, e.value)],
              onChanged: (v) => setState(() => _kind = v ?? 'savings'),
            ),
            gap,
            AppTextField(
              key: const Key('goal.target'),
              label: 'Target (₹)',
              controller: _target,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              validator: (v) => moneyValidator(v, label: 'a target'),
              enabled: !_busy,
            ),
            gap,
            DateField(label: 'Target date (optional)', value: _targetDate, first: DateTime.now(), onChanged: (d) => setState(() => _targetDate = d)),
            gap,
            AppTextField(
              label: 'Plan to save each month (optional, ₹)',
              controller: _monthly,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              validator: (v) => v.trim().isEmpty ? null : moneyValidator(v),
              enabled: !_busy,
            ),
            gap,
            AppTextField(
              label: 'Already saved (optional, ₹)',
              controller: _initial,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              validator: (v) => v.trim().isEmpty ? null : moneyValidator(v, allowZero: true),
              enabled: !_busy,
            ),
            gap,
            SelectField<int>(
              label: 'Priority',
              value: _priority,
              items: const [(1, 'High'), (2, 'Medium'), (3, 'Low')],
              onChanged: (v) => setState(() => _priority = v ?? 2),
            ),
            gap,
            Text('How should saved money count?', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: Space.sm),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'track_only', label: Text('Track only')),
                ButtonSegment(value: 'reserve', label: Text('Set aside')),
              ],
              selected: {_mode},
              onSelectionChanged: (s) => setState(() => _mode = s.first),
            ),
            const SizedBox(height: Space.sm),
            Text(_allocationHelp, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: Space.xl),
            PrimaryButton(key: const Key('goal.submit'), label: 'Add goal', busy: _busy, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}

class GoalDetailScreen extends ConsumerStatefulWidget {
  const GoalDetailScreen({super.key, required this.id});

  final String id;

  @override
  ConsumerState<GoalDetailScreen> createState() => _GoalDetailScreenState();
}

class _GoalDetailScreenState extends ConsumerState<GoalDetailScreen> {
  String? _lastBody;
  String _key = ApiClient.newIdempotencyKey();

  Future<void> _move(Goal g, String type) async {
    final amount = TextEditingController();
    final note = TextEditingController();
    final formKey = GlobalKey<FormState>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(type == 'contribution' ? 'Add money to ${g.name}' : 'Take money out of ${g.name}'),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                key: const Key('goal.move.amount'),
                controller: amount,
                autofocus: true,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: 'Amount (₹)', helperText: type == 'withdrawal' ? 'Up to ${g.saved.format()}' : null),
                validator: (v) => moneyValidator(v ?? ''),
              ),
              TextFormField(
                controller: note,
                decoration: const InputDecoration(labelText: 'Note (optional)'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (formKey.currentState!.validate()) Navigator.pop(ctx, true);
            },
            child: Text(type == 'contribution' ? 'Add money' : 'Withdraw'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final body = {'type': type, 'amount': moneyForApi(amount.text), if (note.text.trim().isNotEmpty) 'note': note.text.trim()};
    final encoded = jsonEncode(body);
    if (encoded != _lastBody) {
      _key = ApiClient.newIdempotencyKey();
      _lastBody = encoded;
    }
    try {
      await ref.read(financeApiProvider).contribute(g.id, body, idempotencyKey: _key);
      _lastBody = null;
      refreshFinancialData(ref);
      if (mounted) showMessage(context, type == 'contribution' ? 'Added ${Money.tryParseInput(amount.text)!.format()} to ${g.name}.' : 'Withdrawn.');
    } catch (e) {
      if (mounted) showMessage(context, userMessage(e), error: true);
    }
  }

  Future<void> _run(Future<void> Function() action, String done) async {
    try {
      await action();
      refreshFinancialData(ref);
      if (mounted) showMessage(context, done);
    } catch (e) {
      if (mounted) showMessage(context, userMessage(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = ref.watch(goalDetailProvider(widget.id));
    final api = ref.read(financeApiProvider);
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(detail.value?.goal.name ?? 'Goal'), leading: backTo(context, '/goals')),
      body: detail.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(Space.lg),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(userMessage(e), textAlign: TextAlign.center),
                const SizedBox(height: Space.md),
                OutlinedButton(onPressed: () => ref.invalidate(goalDetailProvider(widget.id)), child: const Text('Try again')),
              ],
            ),
          ),
        ),
        data: (d) {
          final g = d.goal;
          final archived = g.status == 'archived';
          return FormBody(
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(Space.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('${Fmt.percent(g.progressPercent)} of ${g.targetAmount.format()}', style: text.titleMedium),
                      const SizedBox(height: Space.sm),
                      LinearProgressIndicator(value: Fmt.fraction(g.progressPercent), minHeight: 10),
                      const SizedBox(height: Space.md),
                      Row(
                        children: [
                          Expanded(
                            child: AmountTile(label: 'Saved', amount: g.saved),
                          ),
                          Expanded(
                            child: AmountTile(label: 'Still needed', amount: g.remaining),
                          ),
                        ],
                      ),
                      const SizedBox(height: Space.sm),
                      Text(
                        g.reserves
                            ? '${g.allocated.format()} of this is set aside and not counted in available-to-spend.'
                            : 'Track only: this goal does not change available-to-spend.',
                        style: text.bodySmall,
                      ),
                      if (g.targetDate != null) Text('Target date ${Fmt.day(g.targetDate!)}${g.targetDatePassed ? ' (passed)' : ''}', style: text.bodySmall),
                      if (g.recommendedMonthly != null) Text('Recommended: ${g.recommendedMonthly!.format()} a month.', style: text.bodySmall),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: Space.lg),
              if (!archived)
                Wrap(
                  spacing: Space.sm,
                  runSpacing: Space.sm,
                  children: [
                    FilledButton.icon(
                      key: const Key('goal.add'),
                      onPressed: () => _move(g, 'contribution'),
                      icon: const Icon(Icons.add),
                      label: const Text('Add money'),
                    ),
                    OutlinedButton(onPressed: g.saved.isZero ? null : () => _move(g, 'withdrawal'), child: const Text('Withdraw')),
                    OutlinedButton(
                      onPressed: () => _run(
                        () => api.updateGoal(g.id, {'allocationMode': g.reserves ? 'track_only' : 'reserve'}),
                        g.reserves ? 'Now tracking only.' : 'Savings now set aside.',
                      ),
                      child: Text(g.reserves ? 'Switch to track only' : 'Set savings aside'),
                    ),
                    if (g.status != 'completed')
                      TextButton(onPressed: () => _run(() => api.completeGoal(g.id), 'Marked as reached.'), child: const Text('Mark reached')),
                    TextButton(
                      onPressed: () async {
                        final ok = await confirmAction(
                          context,
                          title: 'Archive ${g.name}?',
                          message: 'The goal is hidden and any money set aside for it counts as available again. Its history is kept.',
                          confirmLabel: 'Archive goal',
                        );
                        if (ok) await _run(() => api.archiveGoal(g.id), 'Goal archived.');
                        if (ok && context.mounted) leave(context, '/goals');
                      },
                      child: const Text('Archive'),
                    ),
                  ],
                ),
              const SizedBox(height: Space.xl),
              Text('History', style: text.titleMedium),
              if (d.contributions.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: Space.sm),
                  child: Text('Nothing recorded yet.'),
                ),
              for (final c in d.contributions)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('${c.type == 'withdrawal' ? 'Withdrawn' : (c.type == 'reversal' ? 'Reversal' : 'Added')} ${c.amount.abs().format()}'),
                  subtitle: Text([Fmt.day(c.date), ?c.note, if (c.reversed) 'reversed'].join(' · ')),
                  trailing: c.type == 'reversal' || c.reversed || archived
                      ? null
                      : TextButton(
                          onPressed: () async {
                            final ok = await confirmAction(
                              context,
                              title: 'Reverse this entry?',
                              message: 'An opposite entry is recorded; the original stays in the history.',
                              confirmLabel: 'Reverse entry',
                            );
                            if (ok) await _run(() => api.reverseContribution(g.id, c.id), 'Entry reversed.');
                          },
                          child: const Text('Reverse'),
                        ),
                ),
            ],
          );
        },
      ),
    );
  }
}
