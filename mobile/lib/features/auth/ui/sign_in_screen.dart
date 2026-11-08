import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/widgets.dart';
import '../state/auth_controller.dart';
import 'validators.dart';

class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).signIn(_email.text, _password.text);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.kind == ApiErrorKind.unauthorized ? 'That email and password don’t match. Check them, or reset your password.' : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final notice = ref.watch(authControllerProvider.select((s) => s.notice));
    return Scaffold(
      body: FormPage(
        title: 'Welcome back',
        subtitle: 'Sign in to see what you have, what’s committed, and what you can spend.',
        children: [
          if (notice != null && _error == null) ...[MessageBanner(message: notice, tone: BannerTone.info), const SizedBox(height: Space.lg)],
          if (_error != null) ...[MessageBanner(message: _error!), const SizedBox(height: Space.lg)],
          AutofillGroup(
            child: Form(
              key: _form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AppTextField(
                    key: const Key('signIn.email'),
                    label: 'Email',
                    controller: _email,
                    validator: Validators.email,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.email],
                    enabled: !_busy,
                  ),
                  const SizedBox(height: Space.lg),
                  AppTextField(
                    key: const Key('signIn.password'),
                    label: 'Password',
                    controller: _password,
                    validator: Validators.passwordForSignIn,
                    obscure: true,
                    textInputAction: TextInputAction.done,
                    autofillHints: const [AutofillHints.password],
                    onSubmitted: (_) => _submit(),
                    enabled: !_busy,
                  ),
                ],
              ),
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(onPressed: _busy ? null : () => context.push('/forgot-password'), child: const Text('Forgot password?')),
          ),
          const SizedBox(height: Space.sm),
          PrimaryButton(key: const Key('signIn.submit'), label: 'Sign in', busy: _busy, onPressed: _submit),
          const SizedBox(height: Space.md),
          OutlinedButton(onPressed: _busy ? null : () => context.go('/register'), child: const Text('Create an account')),
        ],
      ),
    );
  }
}
