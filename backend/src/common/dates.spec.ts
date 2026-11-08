import { addDays, addMonths, daysBetween, monthRange, nextOccurrence, today } from './dates';

describe('date helpers', () => {
  it('keeps the anchor day across short months', () => {
    expect(addMonths('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2028-01-31', 1, 31)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1, 15)).toBe('2027-01-15');
  });

  it('computes next occurrences', () => {
    expect(nextOccurrence('2026-12-01', 'monthly', 1, 1)).toBe('2027-01-01');
    expect(nextOccurrence('2026-12-01', 'weekly', 2, 1)).toBe('2026-12-15');
    expect(nextOccurrence('2026-12-01', 'custom_days', 10, 1)).toBe('2026-12-11');
    expect(nextOccurrence('2024-02-29', 'yearly', 1, 29)).toBe('2025-02-28');
    expect(nextOccurrence('2026-12-01', 'once', 1, 1)).toBeNull();
  });

  it('handles day arithmetic and ranges', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-11-08', '2026-12-01')).toBe(23);
    expect(monthRange('2026-11-08')).toEqual({ from: '2026-11-01T00:00:00+05:30', to: '2026-12-01T00:00:00+05:30', monthStart: '2026-11-01' });
    // 20:00 UTC on 31 Dec is already 1 Jan in India.
    expect(today('Asia/Kolkata', new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
  });
});
