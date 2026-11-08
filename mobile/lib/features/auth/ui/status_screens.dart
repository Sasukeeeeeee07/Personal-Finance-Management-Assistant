import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../shared/widgets.dart';
import '../state/auth_controller.dart';

/// Shown while a stored session is being confirmed with the server on launch.
class RestoringScreen extends StatelessWidget {
  const RestoringScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(child: Semantics(label: 'Loading your account', child: const CircularProgressIndicator())),
      );
}

/// Tokens exist but the server can't be reached. Nothing financial is shown unverified.
class OfflineScreen extends ConsumerStatefulWidget {
  const OfflineScreen({super.key});

  @override
  ConsumerState<OfflineScreen> createState() => _OfflineScreenState();
}

class _OfflineScreenState extends ConsumerState<OfflineScreen> {
  bool _busy = false;

  Future<void> _retry() async {
    setState(() => _busy = true);
    await ref.read(authControllerProvider.notifier).restore();
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: FormPage(
        title: 'You’re offline',
        subtitle: 'We can’t reach the server to confirm your session. Check your internet connection, then try again.',
        children: [
          const Icon(Icons.cloud_off_outlined, size: 56),
          const SizedBox(height: Space.xl),
          PrimaryButton(label: 'Try again', busy: _busy, onPressed: _retry),
          const SizedBox(height: Space.md),
          OutlinedButton(
            onPressed: _busy ? null : () => ref.read(authControllerProvider.notifier).signOut(),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
  }
}
