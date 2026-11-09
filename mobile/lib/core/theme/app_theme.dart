import 'package:flutter/material.dart';

/// Design tokens shared by every screen (and mirrored by the web dashboard later).
abstract final class Space {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
}

abstract final class Radii {
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
}

/// Semantic colours that Material's scheme does not cover.
@immutable
class FinanceColors extends ThemeExtension<FinanceColors> {
  const FinanceColors({required this.positive, required this.negative, required this.reserved, required this.warning});

  final Color positive;
  final Color negative;
  final Color reserved;
  final Color warning;

  static const light = FinanceColors(positive: Color(0xFF1B7F4B), negative: Color(0xFFB3261E), reserved: Color(0xFF6750A4), warning: Color(0xFF9A6700));
  static const dark = FinanceColors(positive: Color(0xFF7DDBA4), negative: Color(0xFFF2B8B5), reserved: Color(0xFFCFBCFF), warning: Color(0xFFF5C35B));

  @override
  FinanceColors copyWith({Color? positive, Color? negative, Color? reserved, Color? warning}) => FinanceColors(
    positive: positive ?? this.positive,
    negative: negative ?? this.negative,
    reserved: reserved ?? this.reserved,
    warning: warning ?? this.warning,
  );

  @override
  FinanceColors lerp(FinanceColors? other, double t) => other == null
      ? this
      : FinanceColors(
          positive: Color.lerp(positive, other.positive, t)!,
          negative: Color.lerp(negative, other.negative, t)!,
          reserved: Color.lerp(reserved, other.reserved, t)!,
          warning: Color.lerp(warning, other.warning, t)!,
        );
}

abstract final class AppTheme {
  static const _seed = Color(0xFF0F6E66); // deep teal: calm, trustworthy, not "alert" red/green

  static ThemeData light() => _build(ColorScheme.fromSeed(seedColor: _seed), FinanceColors.light);
  static ThemeData dark() => _build(ColorScheme.fromSeed(seedColor: _seed, brightness: Brightness.dark), FinanceColors.dark);

  static ThemeData _build(ColorScheme scheme, FinanceColors finance) {
    final base = ThemeData(useMaterial3: true, colorScheme: scheme);
    final border = OutlineInputBorder(borderRadius: BorderRadius.circular(Radii.md));
    return base.copyWith(
      extensions: [finance],
      scaffoldBackgroundColor: scheme.surface,
      appBarTheme: AppBarTheme(backgroundColor: scheme.surface, surfaceTintColor: Colors.transparent, centerTitle: false, elevation: 0),
      inputDecorationTheme: InputDecorationTheme(
        border: border,
        enabledBorder: border.copyWith(borderSide: BorderSide(color: scheme.outlineVariant)),
        focusedBorder: border.copyWith(borderSide: BorderSide(color: scheme.primary, width: 2)),
        errorBorder: border.copyWith(borderSide: BorderSide(color: scheme.error)),
        contentPadding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.lg),
        floatingLabelBehavior: FloatingLabelBehavior.always,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.md)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.md)),
        ),
      ),
      // Five destinations must fit a 360–375 px phone without wrapping "Transactions".
      navigationBarTheme: NavigationBarThemeData(
        labelTextStyle: WidgetStatePropertyAll(base.textTheme.labelSmall?.copyWith(fontSize: 11, fontWeight: FontWeight.w500)),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.lg),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
    );
  }
}
