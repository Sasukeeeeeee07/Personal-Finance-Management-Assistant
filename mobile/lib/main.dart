import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_web_plugins/url_strategy.dart';

import 'core/router/router.dart';
import 'core/theme/app_theme.dart';

void main() {
  // Real paths (/reset-password?token=…) instead of #/ fragments, so links in emails and browser
  // refreshes work. The host must serve index.html for unknown paths (see mobile/web/vercel.json).
  usePathUrlStrategy();
  runApp(const ProviderScope(child: PfmApp()));
}

class PfmApp extends ConsumerWidget {
  const PfmApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Personal Finance',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.system,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
