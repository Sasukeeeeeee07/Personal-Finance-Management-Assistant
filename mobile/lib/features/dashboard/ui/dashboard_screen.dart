import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/format.dart';
import '../../auth/state/auth_controller.dart';
import '../data/dashboard_models.dart';
import '../state/dashboard_providers.dart';
import 'dashboard_sections.dart';
import 'section_card.dart';

/// Home: what you have, what is committed, what you can spend, and where the month is heading.
/// Every figure is rendered from the API as received — no financial arithmetic in the app.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider.select((s) => s.user));
    final summary = ref.watch(dashboardSummaryProvider);
    final budgets = ref.watch(budgetsProvider);
    final forecast = ref.watch(forecastProvider);
    final recent = ref.watch(recentTransactionsProvider);
    final lookups = ref.watch(lookupsProvider);
    final categories = lookups.value?.categories ?? const <String, CategoryRef>{};
    final allLookups = lookups.value ?? Lookups.empty;

    final offline = [summary, budgets, forecast, recent].any((v) => v.hasError && v.error is ApiError && (v.error as ApiError).isOffline);

    final hero = SectionCard<DashboardSummary>(
      title: 'Your money',
      icon: Icons.account_balance_wallet_outlined,
      value: summary,
      skeletonLines: 4,
      onRetry: () => ref.invalidate(dashboardSummaryProvider),
      builder: (_, s) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AvailableHero(summary: s),
          const SizedBox(height: Space.lg),
          MoneyOverview(summary: s),
        ],
      ),
    );
    final budgetCard = SectionCard<List<BudgetStatus>>(
      title: 'Budgets',
      icon: Icons.donut_large_outlined,
      value: budgets,
      onRetry: () => ref.invalidate(budgetsProvider),
      builder: (_, b) => BudgetOverview(budgets: b, categories: categories),
    );
    final lockCard = SectionCard<DashboardSummary>(
      title: 'Money Lock',
      icon: Icons.lock_clock_outlined,
      value: summary,
      onRetry: () => ref.invalidate(dashboardSummaryProvider),
      builder: (_, s) => MoneyLockOverview(summary: s),
    );
    final forecastCard = SectionCard<Forecast>(
      title: 'Month-end forecast',
      icon: Icons.insights_outlined,
      value: forecast,
      onRetry: () => ref.invalidate(forecastProvider),
      builder: (_, f) => ForecastOverview(forecast: f),
    );
    final recentCard = SectionCard<List<TransactionItem>>(
      title: 'Recent transactions',
      icon: Icons.receipt_long_outlined,
      value: recent,
      skeletonLines: 4,
      onRetry: () {
        ref.invalidate(recentTransactionsProvider);
        ref.invalidate(lookupsProvider);
      },
      builder: (_, items) => RecentTransactions(items: items, lookups: allLookups),
    );

    final today = summary.value?.asOf;
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => refreshDashboard(ref),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final wide = constraints.maxWidth >= 840;
              final header = Padding(
                padding: const EdgeInsets.only(bottom: Space.lg),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Hi, ${user?.fullName.split(' ').first ?? 'there'}',
                            style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w600),
                          ),
                          if (today != null)
                            Text(
                              Fmt.longToday(today),
                              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
                            ),
                        ],
                      ),
                    ),
                    // Pull-to-refresh is touch-only; this keeps refresh available with a mouse, keyboard or screen reader.
                    const _RefreshButton(),
                  ],
                ),
              );
              const gap = SizedBox(height: Space.lg);
              final content = wide
                  ? Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: Column(children: [hero, gap, forecastCard])),
                        const SizedBox(width: Space.lg),
                        Expanded(child: Column(children: [budgetCard, gap, lockCard, gap, recentCard])),
                      ],
                    )
                  : Column(children: [hero, gap, budgetCard, gap, lockCard, gap, forecastCard, gap, recentCard]);
              return ListView(
                // Always scrollable so pull-to-refresh works even when content is short.
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(Space.lg),
                children: [
                  Center(
                    child: ConstrainedBox(
                      constraints: BoxConstraints(maxWidth: wide ? 1200 : 640),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          header,
                          if (offline) ...[const _OfflineBanner(), gap],
                          content,
                        ],
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _RefreshButton extends ConsumerStatefulWidget {
  const _RefreshButton();

  @override
  ConsumerState<_RefreshButton> createState() => _RefreshButtonState();
}

class _RefreshButtonState extends ConsumerState<_RefreshButton> {
  bool _busy = false;

  Future<void> _refresh() async {
    setState(() => _busy = true);
    await refreshDashboard(ref);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) => IconButton(
    key: const Key('dashboard.refresh'),
    tooltip: 'Refresh',
    onPressed: _busy ? null : _refresh,
    icon: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.refresh),
  );
}

class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(Space.md),
        decoration: BoxDecoration(color: scheme.secondaryContainer, borderRadius: BorderRadius.circular(Radii.md)),
        child: Row(
          children: [
            Icon(Icons.cloud_off_outlined, color: scheme.onSecondaryContainer),
            const SizedBox(width: Space.md),
            Expanded(
              child: Text('You’re offline. Pull down or tap Refresh to try again when you’re connected.', style: TextStyle(color: scheme.onSecondaryContainer)),
            ),
          ],
        ),
      ),
    );
  }
}
