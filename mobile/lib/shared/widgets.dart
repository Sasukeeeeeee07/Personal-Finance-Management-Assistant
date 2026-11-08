import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';

/// Text field with a visible label, validation after the field loses focus (or on submit), and an
/// optional server-side error that clears as soon as the user edits the field.
class AppTextField extends StatefulWidget {
  const AppTextField({
    super.key,
    required this.label,
    required this.controller,
    this.validator,
    this.hint,
    this.helper,
    this.serverError,
    this.onChanged,
    this.keyboardType,
    this.textInputAction,
    this.onSubmitted,
    this.autofillHints,
    this.obscure = false,
    this.enabled = true,
  });

  final String label;
  final TextEditingController controller;
  final String? Function(String value)? validator;
  final String? hint;
  final String? helper;
  final String? serverError;
  final VoidCallback? onChanged;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;
  final Iterable<String>? autofillHints;
  final bool obscure;
  final bool enabled;

  @override
  State<AppTextField> createState() => _AppTextFieldState();
}

class _AppTextFieldState extends State<AppTextField> {
  final _focus = FocusNode();
  bool _touched = false;
  bool _hidden = true;

  @override
  void initState() {
    super.initState();
    _focus.addListener(() {
      if (!_focus.hasFocus && !_touched) setState(() => _touched = true);
    });
  }

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: widget.controller,
      focusNode: _focus,
      enabled: widget.enabled,
      obscureText: widget.obscure && _hidden,
      keyboardType: widget.keyboardType,
      textInputAction: widget.textInputAction,
      autofillHints: widget.autofillHints,
      onFieldSubmitted: widget.onSubmitted,
      autovalidateMode: _touched ? AutovalidateMode.always : AutovalidateMode.disabled,
      onChanged: (_) => widget.onChanged?.call(),
      validator: (v) => widget.validator?.call(v ?? '') ?? widget.serverError,
      decoration: InputDecoration(
        labelText: widget.label,
        hintText: widget.hint,
        helperText: widget.helper,
        helperMaxLines: 2,
        errorMaxLines: 3,
        suffixIcon: widget.obscure
            ? IconButton(
                tooltip: _hidden ? 'Show password' : 'Hide password',
                icon: Icon(_hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                onPressed: () => setState(() => _hidden = !_hidden),
              )
            : null,
      ),
    );
  }
}

/// Primary action with an inline spinner while busy. Stays tappable-looking but ignores taps while busy.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({super.key, required this.label, required this.onPressed, this.busy = false});

  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: busy ? null : onPressed,
      child: busy
          ? SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Theme.of(context).colorScheme.onPrimary))
          : Text(label),
    );
  }
}

enum BannerTone { error, info, success }

/// Inline message for form-level outcomes (errors with a recovery hint, confirmations, notices).
class MessageBanner extends StatelessWidget {
  const MessageBanner({super.key, required this.message, this.tone = BannerTone.error, this.action});

  final String message;
  final BannerTone tone;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (bg, fg, icon) = switch (tone) {
      BannerTone.error => (scheme.errorContainer, scheme.onErrorContainer, Icons.error_outline),
      BannerTone.info => (scheme.secondaryContainer, scheme.onSecondaryContainer, Icons.info_outline),
      BannerTone.success => (scheme.primaryContainer, scheme.onPrimaryContainer, Icons.check_circle_outline),
    };
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(Space.md),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(Radii.md)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: fg, size: 20),
            const SizedBox(width: Space.md),
            Expanded(child: Text(message, style: TextStyle(color: fg))),
            if (action != null) action!,
          ],
        ),
      ),
    );
  }
}

/// Centred, width-limited column for auth and settings forms (readable on tablets and web).
class FormPage extends StatelessWidget {
  const FormPage({super.key, required this.children, this.title, this.subtitle});

  final String? title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: Space.xl, vertical: Space.xxl),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (title != null) Text(title!, style: text.headlineMedium?.copyWith(fontWeight: FontWeight.w600)),
                if (subtitle != null) ...[
                  const SizedBox(height: Space.sm),
                  Text(subtitle!, style: text.bodyLarge?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                ],
                if (title != null || subtitle != null) const SizedBox(height: Space.xl),
                ...children,
              ],
            ),
          ),
        ),
      ),
    );
  }
}
