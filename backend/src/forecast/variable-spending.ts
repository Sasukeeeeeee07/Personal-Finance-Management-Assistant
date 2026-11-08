import Decimal from 'decimal.js';
import { addDays, daysBetween } from '../common/dates';

/** Day offsets before as-of (1 = the day before). */
export const WINDOWS = [
  { label: 'last_7_days', from: 1, to: 7 },
  { label: 'days_8_to_30', from: 8, to: 30 },
  { label: 'days_31_to_90', from: 31, to: 90 },
] as const;

/** [start, end) dates of each window, oldest first in time but listed in WINDOWS order. */
export function windowRanges(asOf: string) {
  return WINDOWS.map((w) => ({ ...w, start: addDays(asOf, -w.to), end: addDays(asOf, -w.from + 1) }));
}

export interface VariableSpendResult {
  method: 'weighted_recent' | 'simple_average' | 'no_history';
  dailyAverage: Decimal;
  historyDays: number;
  windows: { label: string; coveredDays: number; total: Decimal; dailyAverage: Decimal; weight: number }[];
}

/**
 * Weighted recent daily spending (D-016).
 * Each window's daily average counts only the days the user has history for. Weights of windows
 * with no history are redistributed proportionally. With under 7 days of history, a simple
 * average over the available days is used instead.
 */
export function weightedDailySpend(input: { asOf: string; firstDay: string | null; windowTotals: Decimal[]; weights: [number, number, number] }): VariableSpendResult {
  const ranges = windowRanges(input.asOf);
  const historyDays = input.firstDay ? Math.max(0, Math.min(daysBetween(input.firstDay, input.asOf), 90)) : 0;
  const windows = ranges.map((r, i) => {
    const firstCovered = input.firstDay && input.firstDay > r.start ? input.firstDay : r.start;
    const coveredDays = input.firstDay ? Math.max(0, daysBetween(firstCovered, r.end)) : 0;
    const total = input.windowTotals[i] ?? new Decimal(0);
    return { label: r.label, coveredDays, total, dailyAverage: coveredDays ? total.div(coveredDays) : new Decimal(0), weight: 0 };
  });
  if (historyDays === 0) return { method: 'no_history', dailyAverage: new Decimal(0), historyDays, windows };

  if (historyDays < 7) {
    const total = windows.reduce((acc, w) => acc.plus(w.total), new Decimal(0));
    return { method: 'simple_average', dailyAverage: total.div(historyDays).toDecimalPlaces(2), historyDays, windows };
  }
  const usable = windows.map((w, i) => (w.coveredDays > 0 ? input.weights[i] : 0));
  const weightSum = usable.reduce((a, b) => a + b, 0);
  let daily = new Decimal(0);
  windows.forEach((w, i) => {
    w.weight = weightSum ? usable[i] / weightSum : 0;
    daily = daily.plus(w.dailyAverage.times(w.weight));
  });
  return { method: 'weighted_recent', dailyAverage: daily.toDecimalPlaces(2), historyDays, windows };
}
