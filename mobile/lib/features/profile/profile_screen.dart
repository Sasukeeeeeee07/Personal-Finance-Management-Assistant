import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/widgets.dart';
import '../auth/state/auth_controller.dart';

/// Profile and session settings. Every control here calls the real API.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  bool _sendingVerification = false;
  bool _signingOut = false;
  String? _message;
  BannerTone _tone = BannerTone.info;

  Future<void> _resendVerification() async {
    setState(() => _sendingVerification = true);
    try {
      await ref.read(authApiProvider).resendVerification();
      _show('Verification email sent. Open the link in it to confirm your address.', BannerTone.success);
    } on ApiError catch (e) {
      _show(e.message, BannerTone.error);
    } finally {
      if (mounted) setState(() => _sendingVerification = false);
    }
  }

  Future<void> _refresh() async {
    await ref.read(authControllerProvider.notifier).refreshUser();
  }

  Future<void> _signOutEverywhere() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out of all devices?'),
        content: const Text('You’ll be signed out here and on every other phone, tablet or browser where you’re signed in.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep me signed in')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sign out everywhere')),
        ],
      ),
    );
    if (confirmed == true) await _signOut(allDevices: true);
  }

  Future<void> _signOut({bool allDevices = false}) async {
    setState(() => _signingOut = true);
    try {
      await ref.read(authControllerProvider.notifier).signOut(allDevices: allDevices);
    } on ApiError catch (e) {
      // Only "all devices" can fail: it needs the server. The user stays signed in to retry.
      _show(e.isOffline ? 'You’re offline, so other devices couldn’t be signed out. Try again when you’re connected.' : e.message, BannerTone.error);
      if (mounted) setState(() => _signingOut = false);
    }
  }

  void _show(String message, BannerTone tone) {
    if (!mounted) return;
    setState(() {
      _message = message;
      _tone = tone;
    });
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authControllerProvider).user;
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    if (user == null) return const SizedBox.shrink();
    final org = user.activeOrganization;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(Space.lg),
          children: [
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 560),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(radius: 28, child: Text(_initials(user.fullName), style: text.titleMedium)),
                        const SizedBox(width: Space.lg),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(user.fullName, style: text.titleLarge?.copyWith(fontWeight: FontWeight.w600)),
                              Text(user.email, style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: Space.xl),
                    if (_message != null) ...[MessageBanner(message: _message!, tone: _tone), const SizedBox(height: Space.lg)],
                    if (!user.emailVerified) ...[
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(Space.lg),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Confirm your email', style: text.titleMedium),
                              const SizedBox(height: Space.xs),
                              Text(
                                'We sent a link to ${user.email}. Confirming it lets you recover your account if you forget your password.',
                                style: text.bodyMedium,
                              ),
                              const SizedBox(height: Space.md),
                              OutlinedButton.icon(
                                onPressed: _sendingVerification ? null : _resendVerification,
                                icon: const Icon(Icons.mark_email_read_outlined),
                                label: Text(_sendingVerification ? 'Sending…' : 'Resend verification email'),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: Space.lg),
                    ],
                    Card(
                      child: Column(
                        children: [
                          ListTile(
                            leading: const Icon(Icons.verified_user_outlined),
                            title: const Text('Email'),
                            subtitle: Text(user.emailVerified ? 'Verified' : 'Not verified yet'),
                          ),
                          if (org != null)
                            ListTile(
                              leading: const Icon(Icons.workspaces_outline),
                              title: Text(org.name),
                              subtitle: Text('${_roleLabel(org.role)} · ${org.plan[0].toUpperCase()}${org.plan.substring(1)} plan'),
                            ),
                          const ListTile(
                            leading: Icon(Icons.lock_outline),
                            title: Text('Your financial records are private'),
                            subtitle: Text('Organization admins can manage members but never see your accounts or transactions.'),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: Space.xl),
                    PrimaryButton(key: const Key('profile.signOut'), label: 'Sign out', busy: _signingOut, onPressed: () => _signOut()),
                    const SizedBox(height: Space.md),
                    OutlinedButton(onPressed: _signingOut ? null : _signOutEverywhere, child: const Text('Sign out of all devices')),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return (parts.first[0] + (parts.length > 1 ? parts.last[0] : '')).toUpperCase();
  }

  static String _roleLabel(String role) => switch (role) {
    'org_admin' => 'Admin',
    'standard_user' => 'Member',
    _ => role,
  };
}
