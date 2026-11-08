import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/widgets.dart';
import '../state/auth_controller.dart';
import 'validators.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;
  Map<String, String> _fieldErrors = const {};

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _clearFieldError(String field) {
    if (_fieldErrors.containsKey(field)) setState(() => _fieldErrors = {..._fieldErrors}..remove(field));
  }

  Future<void> _submit() async {
    setState(() => _fieldErrors = const {});
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).register(fullName: _name.text, email: _email.text, password: _password.text);
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.code == 'email_taken') {
          _fieldErrors = {'email': e.message};
        } else if (e.fields.isNotEmpty) {
          _fieldErrors = {
            for (final f in ['fullName', 'email', 'password'])
              if (e.fieldError(f) != null) f: e.fieldError(f)!,
          };
          if (_fieldErrors.isEmpty) _error = e.message;
        } else {
          _error = e.message;
        }
      });
      _form.currentState!.validate();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(leading: BackButton(onPressed: () => context.go('/sign-in'))),
      body: FormPage(
        title: 'Create your account',
        subtitle: 'Allocate first. Spend second.',
        children: [
          if (_error != null) ...[MessageBanner(message: _error!), const SizedBox(height: Space.lg)],
          AutofillGroup(
            child: Form(
              key: _form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AppTextField(
                    key: const Key('register.name'),
                    label: 'Full name',
                    controller: _name,
                    validator: Validators.fullName,
                    serverError: _fieldErrors['fullName'],
                    onChanged: () => _clearFieldError('fullName'),
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.name],
                    enabled: !_busy,
                  ),
                  const SizedBox(height: Space.lg),
                  AppTextField(
                    key: const Key('register.email'),
                    label: 'Email',
                    controller: _email,
                    validator: Validators.email,
                    serverError: _fieldErrors['email'],
                    onChanged: () => _clearFieldError('email'),
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.email],
                    enabled: !_busy,
                  ),
                  const SizedBox(height: Space.lg),
                  AppTextField(
                    key: const Key('register.password'),
                    label: 'Password',
                    helper: 'At least 10 characters, with a letter and a number.',
                    controller: _password,
                    validator: Validators.newPassword,
                    serverError: _fieldErrors['password'],
                    onChanged: () => _clearFieldError('password'),
                    obscure: true,
                    textInputAction: TextInputAction.done,
                    autofillHints: const [AutofillHints.newPassword],
                    onSubmitted: (_) => _submit(),
                    enabled: !_busy,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: Space.xl),
          PrimaryButton(key: const Key('register.submit'), label: 'Create account', busy: _busy, onPressed: _submit),
          const SizedBox(height: Space.md),
          TextButton(onPressed: _busy ? null : () => context.go('/sign-in'), child: const Text('I already have an account')),
        ],
      ),
    );
  }
}
