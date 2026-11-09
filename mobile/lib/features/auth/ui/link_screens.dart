import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_error.dart';
import '../../../core/providers.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/widgets.dart';
import '../state/auth_controller.dart';
import 'validators.dart';

/// Opened from the password-reset email: /reset-password?token=…
class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key, required this.token});

  final String? token;

  @override
  ConsumerState<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  bool _done = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authApiProvider).resetPassword(widget.token!, _password.text);
      // A reset signs out every session on the server; clear this device too.
      await ref.read(tokenStoreProvider).clear();
      if (mounted) setState(() => _done = true);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.fieldError('password') ?? e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final missing = widget.token == null || widget.token!.isEmpty;
    return Scaffold(
      body: FormPage(
        title: 'Choose a new password',
        children: [
          if (missing)
            const MessageBanner(message: 'This link is incomplete. Open the link from the email again, or request a new one.')
          else if (_done) ...[
            const MessageBanner(tone: BannerTone.success, message: 'Password changed. You’ve been signed out everywhere — sign in with your new password.'),
            const SizedBox(height: Space.xl),
            PrimaryButton(
              label: 'Go to sign in',
              onPressed: () {
                ref.read(authControllerProvider.notifier).sessionExpired();
                context.go('/sign-in');
              },
            ),
          ] else ...[
            if (_error != null) ...[MessageBanner(message: _error!), const SizedBox(height: Space.lg)],
            Form(
              key: _form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AppTextField(
                    label: 'New password',
                    helper: 'At least 10 characters, with a letter and a number.',
                    controller: _password,
                    obscure: true,
                    validator: Validators.newPassword,
                    autofillHints: const [AutofillHints.newPassword],
                    enabled: !_busy,
                  ),
                  const SizedBox(height: Space.lg),
                  AppTextField(
                    label: 'Repeat new password',
                    controller: _confirm,
                    obscure: true,
                    validator: (v) => v == _password.text ? null : 'The passwords don’t match.',
                    onSubmitted: (_) => _submit(),
                    enabled: !_busy,
                  ),
                ],
              ),
            ),
            const SizedBox(height: Space.xl),
            PrimaryButton(label: 'Change password', busy: _busy, onPressed: _submit),
          ],
          if (missing || (_error != null && !_done)) ...[
            const SizedBox(height: Space.md),
            TextButton(onPressed: () => context.go('/forgot-password'), child: const Text('Request a new link')),
          ],
        ],
      ),
    );
  }
}

/// Opened from the verification email: /verify-email?token=…
class VerifyEmailScreen extends ConsumerStatefulWidget {
  const VerifyEmailScreen({super.key, required this.token});

  final String? token;

  @override
  ConsumerState<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends ConsumerState<VerifyEmailScreen> {
  String? _error;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_verify);
  }

  Future<void> _verify() async {
    if (widget.token == null || widget.token!.isEmpty) {
      setState(() => _error = 'This link is incomplete. Open the link from the email again.');
      return;
    }
    try {
      await ref.read(authApiProvider).verifyEmail(widget.token!);
      if (ref.read(authControllerProvider).status == AuthStatus.signedIn) {
        await ref.read(authControllerProvider.notifier).refreshUser();
      }
      if (mounted) setState(() => _done = true);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final signedIn = ref.watch(authControllerProvider.select((s) => s.status == AuthStatus.signedIn));
    return Scaffold(
      body: FormPage(
        title: 'Confirm your email',
        children: [
          if (_error != null)
            MessageBanner(message: _error!)
          else if (_done)
            const MessageBanner(tone: BannerTone.success, message: 'Your email address is confirmed.')
          else
            const Center(child: CircularProgressIndicator()),
          const SizedBox(height: Space.xl),
          if (_done || _error != null)
            PrimaryButton(label: signedIn ? 'Continue' : 'Go to sign in', onPressed: () => context.go(signedIn ? '/dashboard' : '/sign-in')),
        ],
      ),
    );
  }
}
