import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Signed-in shell: bottom bar on phones, navigation rail on wide screens, and a quick-add button
/// on Home for recording a transaction in two taps.
class HomeShell extends StatelessWidget {
  const HomeShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  static const destinations = [
    (Icons.home_outlined, Icons.home, 'Home'),
    (Icons.receipt_long_outlined, Icons.receipt_long, 'Transactions'),
    (Icons.donut_large_outlined, Icons.donut_large, 'Budget'),
    (Icons.flag_outlined, Icons.flag, 'Goals'),
    (Icons.person_outline, Icons.person, 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 840;
    void go(int i) => shell.goBranch(i, initialLocation: i == shell.currentIndex);
    final quickAdd = shell.currentIndex == 0
        ? FloatingActionButton.extended(
            key: const Key('quickAdd'),
            heroTag: 'quick-add',
            tooltip: 'Add a transaction',
            onPressed: () => context.push('/transactions/new'),
            icon: const Icon(Icons.add),
            label: const Text('Add'),
          )
        : null;
    if (wide) {
      return Scaffold(
        floatingActionButton: quickAdd,
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: shell.currentIndex,
              onDestinationSelected: go,
              labelType: NavigationRailLabelType.all,
              destinations: [
                for (final (icon, selected, label) in destinations)
                  NavigationRailDestination(icon: Icon(icon), selectedIcon: Icon(selected), label: Text(label)),
              ],
            ),
            const VerticalDivider(width: 1),
            Expanded(child: shell),
          ],
        ),
      );
    }
    return Scaffold(
      body: shell,
      floatingActionButton: quickAdd,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: go,
        destinations: [for (final (icon, selected, label) in destinations) NavigationDestination(icon: Icon(icon), selectedIcon: Icon(selected), label: label)],
      ),
    );
  }
}
