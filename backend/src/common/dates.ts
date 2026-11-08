import type { CommitmentFrequency } from '../database/schema';

/** Date-only arithmetic on 'YYYY-MM-DD' strings in UTC, so no timezone can shift a due date. */
const parse = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return { y, m, day };
};
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const format = (y: number, m: number, d: number) => `${y.toString().padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function addDays(date: string, days: number): string {
  const { y, m, day } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, day + days));
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Adds months keeping the anchor day, clamped to month length (31 Jan → 28/29 Feb → 31 Mar). */
export function addMonths(date: string, months: number, anchorDay: number): string {
  const { y, m } = parse(date);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return format(ny, nm, Math.min(anchorDay, daysInMonth(ny, nm)));
}

export function nextOccurrence(date: string, frequency: CommitmentFrequency, interval: number, anchorDay: number): string | null {
  switch (frequency) {
    case 'once':
      return null;
    case 'weekly':
      return addDays(date, 7 * interval);
    case 'custom_days':
      return addDays(date, interval);
    case 'monthly':
      return addMonths(date, interval, anchorDay);
    case 'yearly':
      return addMonths(date, 12 * interval, anchorDay);
  }
}

/** Today's date in the user's timezone (default India Standard Time). */
export function today(timeZone = 'Asia/Kolkata', now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** [start, end) of the calendar month containing `date`, as ISO timestamps in the given UTC offset. */
export function monthRange(date: string, utcOffset = '+05:30'): { from: string; to: string; monthStart: string } {
  const { y, m } = parse(date);
  const start = format(y, m, 1);
  const next = addMonths(start, 1, 1);
  return { from: `${start}T00:00:00${utcOffset}`, to: `${next}T00:00:00${utcOffset}`, monthStart: start };
}

export function daysBetween(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.day) - Date.UTC(a.y, a.m - 1, a.day)) / 86_400_000);
}
