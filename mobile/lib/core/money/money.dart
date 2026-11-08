import 'package:decimal/decimal.dart';

/// Exact money amount. Built from the API's decimal strings ("8000.00") and never converted to
/// `double`. All financial calculations happen on the backend; the app only displays and
/// compares amounts it receives, and validates amounts the user types.
class Money implements Comparable<Money> {
  const Money._(this.value);

  final Decimal value;

  static final Money zero = Money._(Decimal.zero);
  static final RegExp _apiPattern = RegExp(r'^-?\d{1,17}(\.\d{1,2})?$');
  static final RegExp _inputPattern = RegExp(r'^\d{1,17}(\.\d{1,2})?$');

  /// Parses an amount returned by the API. Throws [FormatException] for anything else.
  factory Money.fromApi(String raw) {
    if (!_apiPattern.hasMatch(raw)) throw FormatException('Not a money amount', raw);
    return Money._(Decimal.parse(raw));
  }

  /// Parses what a user typed ("1,500.5" → 1500.50). Returns null when invalid.
  static Money? tryParseInput(String input) {
    final cleaned = input.replaceAll(',', '').replaceAll('₹', '').trim();
    if (!_inputPattern.hasMatch(cleaned)) return null;
    return Money._(Decimal.parse(cleaned));
  }

  bool get isNegative => value < Decimal.zero;
  bool get isZero => value == Decimal.zero;

  Money operator +(Money other) => Money._(value + other.value);
  Money operator -(Money other) => Money._(value - other.value);
  Money abs() => Money._(value.abs());

  /// Canonical string for API requests: always two decimals.
  String toApi() => value.toStringAsFixed(2);

  /// Indian-grouped rupee display: ₹12,34,567.89 (negative: −₹500.00).
  String format({bool symbol = true, bool decimals = true}) {
    final fixed = value.abs().toStringAsFixed(2);
    final parts = fixed.split('.');
    final grouped = _indianGrouping(parts[0]);
    final body = decimals ? '$grouped.${parts[1]}' : grouped;
    return '${isNegative ? '−' : ''}${symbol ? '₹' : ''}$body';
  }

  static String _indianGrouping(String digits) {
    if (digits.length <= 3) return digits;
    final last3 = digits.substring(digits.length - 3);
    var rest = digits.substring(0, digits.length - 3);
    final groups = <String>[];
    while (rest.length > 2) {
      groups.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) groups.insert(0, rest);
    return '${groups.join(',')},$last3';
  }

  @override
  int compareTo(Money other) => value.compareTo(other.value);

  @override
  bool operator ==(Object other) => other is Money && other.value == value;

  @override
  int get hashCode => value.hashCode;

  @override
  String toString() => toApi();
}
