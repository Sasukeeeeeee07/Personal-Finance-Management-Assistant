import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_error.dart';
import '../../../core/providers.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/widgets.dart';
import 'validators.dart';

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authApiProvider).forgotPassword(_email.text.trim());
      if (mounted) setState(() => _sent = true);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(leading: BackButton(onPressed: () => context.canPop() ? context.pop() : context.go('/sign-in'))),
      body: FormPage(
        title: 'Reset your password',
        subtitle: 'Enter the email you signed up with. We’ll send a link to choose a new password.',
        children: [
          if (_sent) ...[
            // The server answers the same way whether or not the email exists.
            const MessageBanner(tone: BannerTone.success, message: 'If an account exists for that email, a reset link is on its way. It expires in 1 hour.'),
            const SizedBox(height: Space.xl),
            PrimaryButton(label: 'Back to sign in', onPressed: () => context.go('/sign-in')),
          ] else ...[
            if (_error != null) ...[MessageBanner(message: _error!), const SizedBox(height: Space.lg)],
            Form(
              key: _form,
              child: AppTextField(
                label: 'Email',
                controller: _email,
                validator: Validators.email,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.email],
                onSubmitted: (_) => _submit(),
                enabled: !_busy,
              ),
            ),
            const SizedBox(height: Space.xl),
            PrimaryButton(label: 'Send reset link', busy: _busy, onPressed: _submit),
          ],
        ],
      ),
    );
  }
}
