import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/api_error.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/forms.dart';
import '../../../shared/widgets.dart';
import '../../dashboard/data/dashboard_models.dart';
import '../../dashboard/state/dashboard_providers.dart';
import '../../finance/finance_models.dart';
import '../../finance/finance_providers.dart';

/// What the form is opened for.
class TransactionFormArgs {
  const TransactionFormArgs({this.existing, this.type, this.accountId, this.payReservation});

  /// Edit this transaction (sends a PATCH with its version).
  final TransactionDetail? existing;
  final String? type;
  final String? accountId;

  /// Pay this Money Lock reservation: creates the expense and settles the reservation in one step.
  final Reservation? payReservation;
}

class TransactionFormScreen extends ConsumerStatefulWidget {
  const TransactionFormScreen({super.key, this.args = const TransactionFormArgs()});

  final TransactionFormArgs args;

  @override
  ConsumerState<TransactionFormScreen> createState() => _TransactionFormScreenState();
}

class _TransactionFormScreenState extends ConsumerState<TransactionFormScreen> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _counterparty = TextEditingController();
  final _description = TextEditingController();
  late String _type;
  String? _accountId;
  String? _destinationId;
  String? _categoryId;
  late DateTime _when;
  bool _planned = false;
  bool _recurring = false;
  bool _busy = false;
  String? _error;
  Map<String, String> _fieldErrors = const {};

  // Idempotency: retrying the same request reuses its key; a changed request gets a new one.
  String? _lastBody;
  String _key = ApiClient.newIdempotencyKey();

  bool get _editing => widget.args.existing != null;
  Reservation? get _paying => widget.args.payReservation;

  @override
  void initState() {
    super.initState();
    final e = widget.args.existing;
    final r = _paying;
    if (e != null) {
      final t = e.item;
      _type = t.type;
      _amount.text = t.amount.toApi();
      _accountId = t.accountId;
      _destinationId = t.destinationAccountId;
      _categoryId = t.categoryId;
      _when = t.occurredAt.toLocal();
      _counterparty.text = (t.isIncome ? t.sourceName : t.merchant) ?? '';
      _description.text = t.description ?? '';
      _planned = e.isPlanned ?? false;
      _recurring = e.isRecurring;
    } else {
      _type = r != null ? 'expense' : (widget.args.type ?? 'expense');
      _accountId = r?.accountId ?? widget.args.accountId;
      _amount.text = r?.targetAmount.toApi() ?? '';
      _counterparty.text = r?.name ?? '';
      _planned = r != null;
      _when = DateTime.now();
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _counterparty.dispose();
    _description.dispose();
    super.dispose();
  }

  Map<String, dynamic> _body({bool acceptDifference = false}) {
    final text = _counterparty.text.trim();
    final body = <String, dynamic>{
      'type': _type,
      'amount': moneyForApi(_amount.text),
      'accountId': _accountId,
      'occurredAt': _when.toUtc().toIso8601String(),
      'description': _description.text.trim(),
      'isRecurring': _recurring,
      if (_type == 'transfer') 'destinationAccountId': _destinationId,
      if (_type != 'transfer') 'categoryId': _categoryId,
      if (_type == 'expense') 'merchant': text,
      if (_type == 'income') 'sourceName': text,
      if (_type == 'expense') 'isPlanned': _planned,
    };
    if (_editing) {
      // PATCH: send nulls explicitly where a field no longer applies.
      body['version'] = widget.args.existing!.item.version;
      if (_type == 'transfer') body['categoryId'] = null;
      if (_type != 'transfer') body['destinationAccountId'] = null;
    } else {
      body.removeWhere((k, v) => v == null || (v is String && v.isEmpty));
      if (_paying != null) {
        body['reservationId'] = _paying!.id;
        if (acceptDifference) body['acceptReservationDifference'] = true;
      }
    }
    return body;
  }

  Future<void> _submit({bool acceptDifference = false}) async {
    setState(() => _fieldErrors = const {});
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = ref.read(financeApiProvider);
    final body = _body(acceptDifference: acceptDifference);
    try {
      if (_editing) {
        await api.updateTransaction(widget.args.existing!.item.id, body);
        refreshFinancialData(ref);
        if (mounted) {
          showMessage(context, 'Transaction updated.');
          Navigator.of(context).pop(true);
        }
        return;
      }
      final encoded = jsonEncode(body);
      if (encoded != _lastBody) {
        _key = ApiClient.newIdempotencyKey();
        _lastBody = encoded;
      }
      final created = await api.createTransaction(body, idempotencyKey: _key);
      refreshFinancialData(ref);
      if (!mounted) return;
      final label = switch (_type) {
        'income' => 'Income',
        'transfer' => 'Transfer',
        _ => _paying != null ? 'Payment' : 'Expense',
      };
      final lines = [
        created.duplicate ? '$label saved as a possible duplicate — it is not counted until you review it.' : '$label saved.',
        ...created.budgetAlerts,
      ];
      showMessage(context, lines.join('\n'));
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (!mounted) return;
      if (e.code == 'reservation_amount_mismatch') {
        // Stop the busy spinner while the person decides.
        setState(() => _busy = false);
        final ok = await confirmAction(
          context,
          title: 'Different amount',
          message: '${e.message}\n\nConfirm to record the payment and close the reservation.',
          confirmLabel: 'Record payment',
          destructive: false,
        );
        setState(() => _busy = false);
        if (ok) await _submit(acceptDifference: true);
        return;
      }
      setState(() {
        if (e.code == 'stale_version') {
          _error = '${e.message} Close this screen and open the transaction again.';
        } else if (e.fields.isNotEmpty) {
          _fieldErrors = {for (final entry in e.fields.entries) entry.key: entry.value.join(' ')};
          _error = 'Some fields need attention.';
        } else {
          _error = e.message;
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickTime() async {
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_when));
    if (t != null) setState(() => _when = DateTime(_when.year, _when.month, _when.day, t.hour, t.minute));
  }

  @override
  Widget build(BuildContext context) {
    final accounts = ref.watch(accountsProvider);
    final lookups = ref.watch(lookupsProvider).value ?? Lookups.empty;
    final active = (accounts.value ?? const <Account>[]).where((a) => !a.archived).toList();
    final title = _editing ? 'Edit transaction' : (_paying != null ? 'Pay ${_paying!.name}' : 'Add transaction');

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: accounts.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(userMessage(e)),
              TextButton(onPressed: () => ref.invalidate(accountsProvider), child: const Text('Try again')),
            ],
          ),
        ),
        data: (_) => active.isEmpty
            ? const FormBody(
                children: [
                  MessageBanner(tone: BannerTone.info, message: 'Add an account first (Profile → Accounts). Every transaction belongs to an account.'),
                ],
              )
            : _buildForm(context, active, lookups),
      ),
    );
  }

  Widget _buildForm(BuildContext context, List<Account> active, Lookups lookups) {
    final kind = _type == 'income' ? 'income' : 'expense';
    final categories = categoriesOf(lookups, kind);
    final text = Theme.of(context).textTheme;
    const gap = SizedBox(height: Space.lg);
    return Form(
      key: _form,
      child: FormBody(
        children: [
          if (_paying != null) ...[
            MessageBanner(
              tone: BannerTone.info,
              message:
                  '${_paying!.reservedAmount.format()} is reserved for ${_paying!.name}. Recording this payment releases the reservation in the same step, so the money is not counted twice.',
            ),
            gap,
          ],
          if (_error != null) ...[MessageBanner(message: _error!), gap],
          if (_paying == null)
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'expense', label: Text('Expense'), icon: Icon(Icons.north_east)),
                ButtonSegment(value: 'income', label: Text('Income'), icon: Icon(Icons.south_west)),
                ButtonSegment(value: 'transfer', label: Text('Transfer'), icon: Icon(Icons.swap_horiz)),
              ],
              selected: {_type},
              onSelectionChanged: _busy
                  ? null
                  : (s) => setState(() {
                      _type = s.first;
                      _categoryId = null;
                    }),
            ),
          if (_type == 'transfer') ...[
            const SizedBox(height: Space.sm),
            Text('Moving money between your own accounts — including paying a credit card bill — is not income or spending.', style: text.bodySmall),
          ],
          gap,
          AppTextField(
            key: const Key('tx.amount'),
            label: 'Amount (₹)',
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            validator: (v) => moneyValidator(v),
            serverError: _fieldErrors['amount'],
            enabled: !_busy,
          ),
          gap,
          SelectField<String>(
            key: const Key('tx.account'),
            label: _type == 'income' ? 'Into account' : (_type == 'transfer' ? 'From account' : 'Paid from'),
            value: _accountId,
            items: [
              for (final a in active) (a.id, '${a.label} · ${a.isLiability ? 'owes ${(a.outstanding ?? a.balance.abs()).format()}' : a.balance.format()}'),
            ],
            onChanged: (v) => setState(() => _accountId = v),
            validator: (v) => v == null ? 'Choose an account.' : null,
          ),
          if (_type == 'transfer') ...[
            gap,
            SelectField<String>(
              key: const Key('tx.destination'),
              label: 'To account',
              value: _destinationId,
              items: [for (final a in active.where((a) => a.id != _accountId)) (a.id, a.isLiability ? '${a.label} (card bill payment)' : a.label)],
              onChanged: (v) => setState(() => _destinationId = v),
              validator: (v) => v == null ? 'Choose the account the money goes to.' : (v == _accountId ? 'Choose a different account.' : null),
            ),
          ],
          if (_type != 'transfer') ...[
            gap,
            SelectField<String?>(
              key: const Key('tx.category'),
              label: 'Category (optional)',
              value: _categoryId,
              items: [(null, 'No category'), for (final c in categories) (c.id, c.name)],
              onChanged: (v) => setState(() => _categoryId = v),
            ),
            gap,
            AppTextField(
              key: const Key('tx.counterparty'),
              label: _type == 'income' ? 'From (optional)' : 'Merchant (optional)',
              hint: _type == 'income' ? 'e.g. Employer name' : 'e.g. Zomato',
              controller: _counterparty,
              enabled: !_busy,
            ),
          ],
          gap,
          Row(
            children: [
              Expanded(
                child: DateField(
                  label: 'Date',
                  value: ymd(_when),
                  last: DateTime.now().add(const Duration(days: 366)),
                  onChanged: (d) {
                    final p = DateTime.parse(d);
                    setState(() => _when = DateTime(p.year, p.month, p.day, _when.hour, _when.minute));
                  },
                ),
              ),
              const SizedBox(width: Space.md),
              SizedBox(
                width: 130,
                child: InkWell(
                  onTap: _pickTime,
                  child: InputDecorator(
                    decoration: const InputDecoration(labelText: 'Time'),
                    child: Text(TimeOfDay.fromDateTime(_when).format(context)),
                  ),
                ),
              ),
            ],
          ),
          gap,
          AppTextField(label: 'Note (optional)', controller: _description, enabled: !_busy),
          if (_type == 'expense' && _paying == null)
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Planned expense'),
              subtitle: const Text('Something you budgeted or reserved for, not an impulse spend.'),
              value: _planned,
              onChanged: _busy ? null : (v) => setState(() => _planned = v),
            ),
          if (_type != 'transfer')
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Repeats every month'),
              subtitle: const Text('Used by the forecast to expect it again next month.'),
              value: _recurring,
              onChanged: _busy ? null : (v) => setState(() => _recurring = v),
            ),
          const SizedBox(height: Space.xl),
          PrimaryButton(
            key: const Key('tx.submit'),
            label: _editing ? 'Save changes' : (_paying != null ? 'Record payment' : 'Save'),
            busy: _busy,
            onPressed: () => _submit(),
          ),
        ],
      ),
    );
  }
}
