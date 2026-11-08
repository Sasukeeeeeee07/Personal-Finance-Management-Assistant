import 'package:intl/intl.dart';

/// Display-only helpers. No financial arithmetic happens here.
abstract final class Fmt {
  static DateTime _date(String ymd) {
    final p = ymd.split('-').map(int.parse).toList();
    return DateTime(p[0], p[1], p[2]);
  }

  /// '2026-11-20' → '20 Nov' (adds the year when it differs from [relativeTo]).
  static String day(String ymd, {String? relativeTo}) {
    final d = _date(ymd);
    final sameYear = relativeTo == null || _date(relativeTo).year == d.year;
    return DateFormat(sameYear ? 'd MMM' : 'd MMM yyyy').format(d);
  }

  /// Calendar distance between two API dates, for labels like "in 3 days".
  static int daysBetween(String fromYmd, String toYmd) => _date(toYmd).difference(_date(fromYmd)).inDays;

  static String dueLabel(String dueYmd, String todayYmd) {
    final n = daysBetween(todayYmd, dueYmd);
    if (n < 0) return 'Overdue by ${-n} ${-n == 1 ? 'day' : 'days'}';
    if (n == 0) return 'Due today';
    if (n == 1) return 'Due tomorrow';
    return 'Due in $n days';
  }

  static String dateTime(DateTime t) => DateFormat('d MMM yyyy, h:mm a').format(t.toLocal());
  static String shortDate(DateTime t) => DateFormat('d MMM').format(t.toLocal());
  static String longToday(String ymd) => DateFormat('EEEE, d MMMM').format(_date(ymd));

  /// Progress-bar fraction from an API percentage string ("62.50" → 0.625), clamped to 0–1.
  /// Percentages are not money; parsing them for a progress indicator is display only.
  static double fraction(String percent) => (double.tryParse(percent) ?? 0).clamp(0, 100) / 100;

  static String percent(String percent) => '${percent.endsWith('.00') ? percent.substring(0, percent.length - 3) : percent}%';
}
