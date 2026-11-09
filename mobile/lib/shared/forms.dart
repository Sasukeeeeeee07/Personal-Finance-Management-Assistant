import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api/api_error.dart';
import '../core/money/money.dart';

/// Validates a typed amount without converting it to a floating-point number.
String? moneyValidator(String v, {bool allowZero = false, String label = 'an amount'}) {
  if (v.trim().isEmpty) return 'Enter $label.';
  final m = Money.tryParseInput(v);
  if (m == null) return 'Enter an amount like 450 or 450.50.';
  if (!allowZero && m.isZero) return 'Enter an amount greater than 0.';
  return null;
}

/// The amount in the API's canonical form ("450.50"). Call only after [moneyValidator] passed.
String moneyForApi(String v) => Money.tryParseInput(v)!.toApi();

String ymd(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

String userMessage(Object e) => e is ApiError ? e.message : 'Something went wrong. Please try again.';

void showMessage(BuildContext context, String message, {bool error = false}) {
  final scheme = Theme.of(context).colorScheme;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? scheme.error : null,
        behavior: SnackBarBehavior.floating,
        duration: Duration(seconds: error ? 6 : 4),
      ),
    );
}

/// Confirmation for destructive or irreversible actions. Names the action on the button.
Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool destructive = true,
}) async {
  final scheme = Theme.of(context).colorScheme;
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        FilledButton(
          style: destructive ? FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError) : null,
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result == true;
}

/// A read-only field that opens a date picker. Value is 'YYYY-MM-DD'.
class DateField extends StatelessWidget {
  const DateField({super.key, required this.label, required this.value, required this.onChanged, this.first, this.last, this.helper, this.enabled = true});

  final String label;
  final String? value;
  final ValueChanged<String> onChanged;
  final DateTime? first;
  final DateTime? last;
  final String? helper;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final shown = value == null ? '' : DateFormat('d MMM yyyy').format(DateTime.parse(value!));
    return InkWell(
      onTap: !enabled
          ? null
          : () async {
              final initial = value == null ? DateTime.now() : DateTime.parse(value!);
              final picked = await showDatePicker(context: context, initialDate: initial, firstDate: first ?? DateTime(2000), lastDate: last ?? DateTime(2100));
              if (picked != null) onChanged(ymd(picked));
            },
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, helperText: helper, enabled: enabled, suffixIcon: const Icon(Icons.calendar_today_outlined)),
        child: Text(shown.isEmpty ? 'Choose a date' : shown),
      ),
    );
  }
}

/// Labelled dropdown with validation.
class SelectField<T> extends StatelessWidget {
  const SelectField({super.key, required this.label, required this.value, required this.items, required this.onChanged, this.validator, this.helper});

  final String label;
  final T? value;
  final List<(T, String)> items;
  final ValueChanged<T?> onChanged;
  final String? Function(T?)? validator;
  final String? helper;

  @override
  Widget build(BuildContext context) {
    final valid = items.any((i) => i.$1 == value);
    return DropdownButtonFormField<T>(
      initialValue: valid ? value : null,
      isExpanded: true,
      decoration: InputDecoration(labelText: label, helperText: helper),
      items: [
        for (final (v, text) in items)
          DropdownMenuItem(
            value: v,
            child: Text(text, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: onChanged,
      validator: validator,
      autovalidateMode: AutovalidateMode.onUserInteraction,
    );
  }
}

/// Scaffold body for a form page: centred, width-limited, scrollable.
class FormBody extends StatelessWidget {
  const FormBody({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
        ),
      ),
    ),
  );
}
