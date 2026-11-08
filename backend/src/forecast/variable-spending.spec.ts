import Decimal from 'decimal.js';
import { weightedDailySpend, windowRanges } from './variable-spending';

const d = (v: number) => new Decimal(v);
const W: [number, number, number] = [0.5, 0.3, 0.2];

describe('weighted variable spending', () => {
  it('defines windows relative to as-of, excluding the as-of day', () => {
    expect(windowRanges('2026-11-08').map((r) => [r.start, r.end])).toEqual([
      ['2026-11-01', '2026-11-08'],
      ['2026-10-09', '2026-11-01'],
      ['2026-08-10', '2026-10-09'],
    ]);
  });

  it('weights 50/30/20 with full 90-day history', () => {
    // 7 days × ₹100, 23 days × ₹50, 60 days × ₹20
    const r = weightedDailySpend({ asOf: '2026-11-08', firstDay: '2026-08-10', windowTotals: [d(700), d(1150), d(1200)], weights: W });
    expect(r.method).toBe('weighted_recent');
    expect(r.historyDays).toBe(90);
    expect(r.windows.map((w) => w.coveredDays)).toEqual([7, 23, 60]);
    expect(r.dailyAverage.toFixed(2)).toBe('69.00'); // 0.5×100 + 0.3×50 + 0.2×20
  });

  it('redistributes weight when older windows have no history', () => {
    // 20 days of history: window 3 empty → weights become 0.625 / 0.375
    const r = weightedDailySpend({ asOf: '2026-11-08', firstDay: '2026-10-19', windowTotals: [d(700), d(650), d(0)], weights: W });
    expect(r.windows.map((w) => w.coveredDays)).toEqual([7, 13, 0]);
    expect(r.windows[2].weight).toBe(0);
    expect(r.dailyAverage.toFixed(2)).toBe('81.25'); // 0.625×100 + 0.375×50
  });

  it('falls back to a simple average with under 7 days of history', () => {
    const r = weightedDailySpend({ asOf: '2026-11-08', firstDay: '2026-11-05', windowTotals: [d(900), d(0), d(0)], weights: W });
    expect(r).toMatchObject({ method: 'simple_average', historyDays: 3 });
    expect(r.dailyAverage.toFixed(2)).toBe('300.00');
  });

  it('reports no history', () => {
    const r = weightedDailySpend({ asOf: '2026-11-08', firstDay: null, windowTotals: [d(0), d(0), d(0)], weights: W });
    expect(r).toMatchObject({ method: 'no_history', historyDays: 0 });
    expect(r.dailyAverage.toFixed(2)).toBe('0.00');
  });

  it('honours configured weights', () => {
    const r = weightedDailySpend({ asOf: '2026-11-08', firstDay: '2026-08-10', windowTotals: [d(700), d(1150), d(1200)], weights: [1, 0, 0] });
    expect(r.dailyAverage.toFixed(2)).toBe('100.00');
  });
});
