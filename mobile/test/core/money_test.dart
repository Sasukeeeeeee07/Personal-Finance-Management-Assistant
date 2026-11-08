import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/money/money.dart';

void main() {
  test('parses API strings exactly and keeps two decimals', () {
    expect(Money.fromApi('8000.00').toApi(), '8000.00');
    expect(Money.fromApi('-5000.00').isNegative, isTrue);
    expect(Money.fromApi('0.10') + Money.fromApi('0.20'), Money.fromApi('0.30')); // no floating-point drift
    expect(() => Money.fromApi('12.345'), throwsFormatException);
    expect(() => Money.fromApi('1e3'), throwsFormatException);
    expect(() => Money.fromApi('abc'), throwsFormatException);
  });

  test('formats with Indian digit grouping', () {
    expect(Money.fromApi('1234567.89').format(), '₹12,34,567.89');
    expect(Money.fromApi('999.00').format(), '₹999.00');
    expect(Money.fromApi('100000.00').format(), '₹1,00,000.00');
    expect(Money.fromApi('-22000.50').format(), '−₹22,000.50');
    expect(Money.fromApi('22000.00').format(decimals: false), '₹22,000');
    expect(Money.fromApi('22000.00').format(symbol: false), '22,000.00');
  });

  test('parses user input safely', () {
    expect(Money.tryParseInput('1,500.5')!.toApi(), '1500.50');
    expect(Money.tryParseInput(' ₹450 ')!.toApi(), '450.00');
    expect(Money.tryParseInput('-5'), isNull);
    expect(Money.tryParseInput('1.234'), isNull);
    expect(Money.tryParseInput(''), isNull);
  });

  test('compares and subtracts exactly', () {
    final available = Money.fromApi('30000.00') - Money.fromApi('8000.00');
    expect(available, Money.fromApi('22000.00'));
    expect(Money.fromApi('10.00').compareTo(Money.fromApi('9.99')), 1);
  });
}
