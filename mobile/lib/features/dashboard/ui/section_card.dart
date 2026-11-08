import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_theme.dart';

/// A dashboard section bound to one provider.
/// * First load → skeleton placeholder.
/// * Data → content; if a later refresh fails, the last figures stay with a "couldn't refresh" note.
/// * Error with no data → a short explanation and a retry button.
class SectionCard<T> extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.title,
    required this.value,
    required this.builder,
    required this.onRetry,
    this.icon,
    this.skeletonLines = 3,
    this.trailing,
  });

  final String title;
  final IconData? icon;
  final AsyncValue<T> value;
  final Widget Function(BuildContext context, T data) builder;
  final VoidCallback onRetry;
  final int skeletonLines;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final data = value.value;
    final Widget body;
    if (value.hasValue) {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (value.hasError) ...[_StaleNote(error: value.error!, onRetry: onRetry), const SizedBox(height: Space.md)],
          builder(context, data as T),
        ],
      );
    } else if (value.hasError) {
      body = _SectionError(error: value.error!, onRetry: onRetry);
    } else {
      body = _Skeleton(lines: skeletonLines);
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(Space.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                if (icon != null) ...[Icon(icon, size: 20, color: scheme.primary), const SizedBox(width: Space.sm)],
                Expanded(child: Semantics(header: true, child: Text(title, style: text.titleMedium?.copyWith(fontWeight: FontWeight.w600)))),
                if (trailing != null) trailing!,
              ],
            ),
            const SizedBox(height: Space.md),
            AnimatedSwitcher(duration: const Duration(milliseconds: 200), child: KeyedSubtree(key: ValueKey(value.hasValue), child: body)),
          ],
        ),
      ),
    );
  }
}

String friendlyError(Object error) => error is ApiError ? error.message : 'Something went wrong. Please try again.';

class _SectionError extends StatelessWidget {
  const _SectionError({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final offline = error is ApiError && (error as ApiError).isOffline;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(offline ? Icons.cloud_off_outlined : Icons.error_outline, size: 20, color: Theme.of(context).colorScheme.error),
            const SizedBox(width: Space.sm),
            Expanded(child: Text(offline ? 'Couldn’t load this while you’re offline.' : friendlyError(error))),
          ],
        ),
        const SizedBox(height: Space.sm),
        TextButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Try again')),
      ],
    );
  }
}

class _StaleNote extends StatelessWidget {
  const _StaleNote({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final offline = error is ApiError && (error as ApiError).isOffline;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: Space.md, vertical: Space.xs),
        decoration: BoxDecoration(color: scheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(Radii.sm)),
        child: Row(
          children: [
            Icon(Icons.history, size: 16, color: scheme.onSurfaceVariant),
            const SizedBox(width: Space.sm),
            Expanded(
              child: Text(
                offline ? 'Offline — showing the last figures loaded.' : 'Couldn’t refresh — showing the last figures loaded.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ),
            TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}

class _Skeleton extends StatelessWidget {
  const _Skeleton({required this.lines});

  final int lines;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.surfaceContainerHighest;
    return Semantics(
      label: 'Loading',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < lines; i++) ...[
            Container(height: 14, width: i.isEven ? double.infinity : 180, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(Radii.sm))),
            if (i < lines - 1) const SizedBox(height: Space.md),
          ],
        ],
      ),
    );
  }
}
