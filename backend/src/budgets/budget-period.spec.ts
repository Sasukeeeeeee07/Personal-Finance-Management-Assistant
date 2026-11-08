import Decimal from 'decimal.js';
import { computeFigures, periodContaining, previousPeriod } from './budget-period';

const monthly = (startDate: string) => ({ period: 'monthly' as const, periodDays: null, startDate });

describe('budget periods', () => {
  it('11. monthly budgets reset on the 1st', () => {
    const r = monthly('2026-01-01');
    expect(periodContaining(r, '2026-11-30')).toEqual({ start: '2026-11-01', end: '2026-12-01' });
    expect(periodContaining(r, '2026-12-01')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });

  it('11. monthly budgets reset on a configured day', () => {
    const r = monthly('2026-01-15');
    expect(periodContaining(r, '2026-11-14')).toEqual({ start: '2026-10-15', end: '2026-11-15' });
    expect(periodContaining(r, '2026-11-15')).toEqual({ start: '2026-11-15', end: '2026-12-15' });
    expect(periodContaining(r, '2027-01-03')).toEqual({ start: '2026-12-15', end: '2027-01-15' });
  });

  it('clamps a 31st reset day in short months', () => {
    const r = monthly('2026-01-31');
    expect(periodContaining(r, '2026-02-28')).toEqual({ start: '2026-02-28', end: '2026-03-31' });
    expect(periodContaining(r, '2026-02-27')).toEqual({ start: '2026-01-31', end: '2026-02-28' });
  });

  it('weekly and custom periods repeat from the start date', () => {
    const w = { period: 'weekly' as const, periodDays: null, startDate: '2026-11-02' };
    expect(periodContaining(w, '2026-11-08')).toEqual({ start: '2026-11-02', end: '2026-11-09' });
    expect(periodContaining(w, '2026-11-09')).toEqual({ start: '2026-11-09', end: '2026-11-16' });
    const c = { period: 'custom' as const, periodDays: 10, startDate: '2026-11-01' };
    expect(periodContaining(c, '2026-11-25')).toEqual({ start: '2026-11-21', end: '2026-12-01' });
  });

  it('has no previous period before the budget started', () => {
    const r = monthly('2026-11-01');
    expect(previousPeriod(r, periodContaining(r, '2026-11-10'))).toBeNull();
    expect(previousPeriod(r, periodContaining(r, '2026-12-10'))).toEqual({ start: '2026-11-01', end: '2026-12-01' });
    // Before the start date, the first period is used.
    expect(periodContaining(r, '2026-10-20')).toEqual({ start: '2026-11-01', end: '2026-12-01' });
  });
});

describe('budget figures', () => {
  const window = { start: '2026-11-01', end: '2026-12-01' };
  const base = { amount: new Decimal(4000), previousSpent: null, rollover: false, thresholds: [50, 75, 90, 100], window, asOf: '2026-11-21' };

  it('food budget ₹4,000 after ₹2,500 spent leaves ₹1,500', () => {
    const f = computeFigures({ ...base, spent: new Decimal(2500) });
    expect(f.remaining.toFixed(2)).toBe('1500.00');
    expect(f.utilizationPercent.toFixed(2)).toBe('62.50');
    expect(f.thresholdsReached).toEqual([50]);
    expect(f.daysLeft).toBe(10);
    expect(f.dailyTarget.toFixed(2)).toBe('150.00');
    expect(f.status).toBe('on_track');
  });

  it('reports exceeded with no daily allowance left', () => {
    const f = computeFigures({ ...base, spent: new Decimal(4200) });
    expect(f).toMatchObject({ exceeded: true, status: 'exceeded', thresholdsReached: [50, 75, 90, 100] });
    expect(f.remaining.toFixed(2)).toBe('-200.00');
    expect(f.dailyTarget.toFixed(2)).toBe('0.00');
  });

  it('rolls over unused budget from the previous period only, without compounding', () => {
    const f = computeFigures({ ...base, spent: new Decimal(0), previousSpent: new Decimal(3000), rollover: true });
    expect(f.carriedOver.toFixed(2)).toBe('1000.00');
    expect(f.limit.toFixed(2)).toBe('5000.00');
    const over = computeFigures({ ...base, spent: new Decimal(0), previousSpent: new Decimal(4500), rollover: true });
    expect(over.carriedOver.toFixed(2)).toBe('0.00');
    const off = computeFigures({ ...base, spent: new Decimal(0), previousSpent: new Decimal(1000), rollover: false });
    expect(off.limit.toFixed(2)).toBe('4000.00');
  });
});
