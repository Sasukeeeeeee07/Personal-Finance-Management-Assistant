import Decimal from 'decimal.js';
import { addDays, addMonths, daysBetween } from '../common/dates';
import type { BudgetPeriod } from '../database/schema';

export interface PeriodRule {
  period: BudgetPeriod;
  periodDays: number | null;
  startDate: string;
}

/** [start, end) as 'YYYY-MM-DD'. */
export interface PeriodWindow {
  start: string;
  end: string;
}

const lengthInDays = (r: PeriodRule) => (r.period === 'weekly' ? 7 : r.periodDays!);

/**
 * The budget period containing `asOf`.
 * Monthly budgets reset on the day-of-month of `startDate`, clamped in short months (D-011).
 * Weekly and custom budgets repeat every 7 / N days from `startDate`.
 * Before the budget starts, the first period is returned.
 */
export function periodContaining(rule: PeriodRule, asOf: string): PeriodWindow {
  const date = asOf < rule.startDate ? rule.startDate : asOf;
  if (rule.period === 'monthly') {
    const anchor = Number(rule.startDate.slice(8, 10));
    let start = addMonths(date.slice(0, 7) + '-01', 0, anchor);
    if (start > date) start = addMonths(start, -1, anchor);
    return { start, end: addMonths(start, 1, anchor) };
  }
  const len = lengthInDays(rule);
  const n = Math.floor(daysBetween(rule.startDate, date) / len);
  const start = addDays(rule.startDate, n * len);
  return { start, end: addDays(start, len) };
}

/** The period before `current`, or null if the budget did not exist yet. */
export function previousPeriod(rule: PeriodRule, current: PeriodWindow): PeriodWindow | null {
  if (current.start <= rule.startDate) return null;
  return periodContaining(rule, addDays(current.start, -1));
}

export interface BudgetFigures {
  limit: Decimal;
  carriedOver: Decimal;
  spent: Decimal;
  remaining: Decimal;
  utilizationPercent: Decimal;
  daysLeft: number;
  dailyTarget: Decimal;
  thresholdsReached: number[];
  exceeded: boolean;
  status: 'on_track' | 'warning' | 'exceeded';
}

/**
 * Pure budget arithmetic.
 * Rollover is one period, non-compounding (D-010): carry = max(0, amount − previous period spending).
 */
export function computeFigures(input: {
  amount: Decimal;
  spent: Decimal;
  previousSpent: Decimal | null;
  rollover: boolean;
  thresholds: number[];
  window: PeriodWindow;
  asOf: string;
}): BudgetFigures {
  const carriedOver = input.rollover && input.previousSpent ? Decimal.max(input.amount.minus(input.previousSpent), 0) : new Decimal(0);
  const limit = input.amount.plus(carriedOver);
  const remaining = limit.minus(input.spent);
  const utilizationPercent = input.spent.div(limit).times(100).toDecimalPlaces(2);
  const from = input.asOf < input.window.start ? input.window.start : input.asOf;
  const daysLeft = Math.max(daysBetween(from, input.window.end), 0);
  const dailyTarget = daysLeft > 0 ? Decimal.max(remaining, 0).div(daysLeft).toDecimalPlaces(2, Decimal.ROUND_DOWN) : new Decimal(0);
  const thresholdsReached = input.thresholds.filter((t) => utilizationPercent.gte(t));
  const exceeded = input.spent.gt(limit);
  return {
    limit,
    carriedOver,
    spent: input.spent,
    remaining,
    utilizationPercent,
    daysLeft,
    dailyTarget,
    thresholdsReached,
    exceeded,
    status: exceeded ? 'exceeded' : utilizationPercent.gte(75) ? 'warning' : 'on_track',
  };
}
