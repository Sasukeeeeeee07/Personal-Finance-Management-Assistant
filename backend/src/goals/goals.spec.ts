import Decimal from 'decimal.js';
import { monthsUntil, projectGoal } from './goals.service';

const d = (v: string | number) => new Decimal(v);
const base = { target: d(100000), saved: d(10000), targetDate: null, monthlyContribution: null, recentMonthlyPace: d(0), asOf: '2026-11-08' };

describe('goal projections', () => {
  it('counts whole months, rounding up', () => {
    expect(monthsUntil('2026-11-08', '2026-11-30')).toBe(1);
    expect(monthsUntil('2026-11-08', '2027-05-08')).toBe(6);
    expect(monthsUntil('2026-11-08', '2027-05-09')).toBe(7);
  });

  it('recommends a monthly amount to hit the target date', () => {
    const p = projectGoal({ ...base, targetDate: '2027-05-08' });
    expect(p.recommendedMonthly!.toFixed(2)).toBe('15000.00');
    const odd = projectGoal({ ...base, target: d(1000), saved: d(0), targetDate: '2027-02-08' });
    expect(odd.recommendedMonthly!.toFixed(2)).toBe('333.34'); // rounded up so the target is reached
  });

  it('estimates completion from the planned contribution, else the recent pace', () => {
    const planned = projectGoal({ ...base, monthlyContribution: d(5000), targetDate: '2028-01-01' });
    expect(planned).toMatchObject({ estimatedCompletionDate: '2028-05-08', paceSource: 'planned_monthly_contribution', onTrack: false });
    const recent = projectGoal({ ...base, recentMonthlyPace: d(30000) });
    expect(recent).toMatchObject({ estimatedCompletionDate: '2027-02-08', paceSource: 'average_of_last_3_months' });
    expect(projectGoal(base)).toMatchObject({ estimatedCompletionDate: null, paceSource: null, onTrack: null });
  });

  it('handles reached and overdue goals', () => {
    const done = projectGoal({ ...base, saved: d(120000) });
    expect(done.progressPercent.toFixed(2)).toBe('100.00');
    expect(done).toMatchObject({ reached: true, onTrack: true, recommendedMonthly: null });
    const late = projectGoal({ ...base, targetDate: '2026-10-01' });
    expect(late.targetPassed).toBe(true);
    expect(late.recommendedMonthly!.toFixed(2)).toBe('90000.00');
  });
});
