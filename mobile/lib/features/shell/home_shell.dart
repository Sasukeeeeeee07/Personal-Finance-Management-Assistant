import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Signed-in shell. Only destinations that exist are shown: Transactions, Budget and Goals tabs,
/// and the quick-add button, are added with their modules (no non-functional controls).
class HomeShell extends StatelessWidget {
  const HomeShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 840;
    const destinations = [(Icons.home_outlined, Icons.home, 'Home'), (Icons.person_outline, Icons.person, 'Profile')];
    void go(int i) => shell.goBranch(i, initialLocation: i == shell.currentIndex);
    if (wide) {
      return Scaffold(
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
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: go,
        destinations: [for (final (icon, selected, label) in destinations) NavigationDestination(icon: Icon(icon), selectedIcon: Icon(selected), label: label)],
      ),
    );
  }
}
