import { Controller, Get, HttpStatus, Inject, Injectable, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ForecastResponse } from '../api-responses';
import { sql } from 'kysely';
import Decimal from 'decimal.js';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { addDays, addMonths, daysBetween, monthRange, nextOccurrence, today } from '../common/dates';
import { DomainError } from '../common/errors';
import { fmt, money } from '../common/money';
import { APP_CONFIG, AppConfig } from '../config/env';
import { DATABASE } from '../database/database.module';
import type { DB } from '../database/schema';
import { AsOfQuery } from '../budgets/budget.dto';
import { PERMISSIONS } from '../rbac/permissions';
import { windowRanges, weightedDailySpend } from './variable-spending';

export const FORECAST_METHOD_VERSION = 'forecast-v2';
const IST = '+05:30';
const IST_DATE = sql<string>`to_char(t.occurred_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;
const startOf = (date: string) => new Date(`${date}T00:00:00${IST}`);

interface Item {
  name: string;
  amount: string;
  date: string;
}

/**
 * Deterministic month-end forecast (D-014, revised by D-016).
 *
 *   estimatedMonthEndBalance = liquid balance at the end of asOf
 *                            + expected recurring income
 *                            − scheduled payments (reservations open at asOf + later commitment occurrences)
 *                            − expected recurring expenses not already covered by a commitment
 *                            − weighted recent daily variable spending × full days left
 *
 * Every figure is reconstructed "as of" the requested date from current records, so a past asOf
 * no longer mixes today's balance with past history.
 */
@Injectable()
export class ForecastService {
  constructor(
    @Inject(DATABASE) private readonly db: DB,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async monthEnd(user: AuthUser, asOfInput?: string) {
    const now = today();
    const asOf = asOfInput ?? now;
    if (asOf > now) throw new DomainError('forecast_future_as_of', 'Choose today or an earlier date for a forecast.', HttpStatus.UNPROCESSABLE_ENTITY);
    const ownerId = user.userId;
    const { monthStart } = monthRange(asOf);
    const nextMonth = addMonths(monthStart, 1, 1);
    const monthEnd = addDays(nextMonth, -1);
    const endOfAsOf = startOf(addDays(asOf, 1));
    const daysLeft = daysBetween(asOf, nextMonth) - 1; // full days after asOf
    const lastMonthStart = addMonths(monthStart, -1, 1);

    // 1. Liquid balance at the end of asOf: opening balances of accounts tracked by then + ledger
    //    entries of transactions dated up to then.
    const balanceRow = await sql<{ total: string }>`
      SELECT COALESCE(SUM(a.opening_balance), 0) + COALESCE((
        SELECT SUM(l.amount) FROM ledger_entries l
        JOIN transactions t ON t.id = l.transaction_id
        JOIN bank_accounts a2 ON a2.id = l.account_id
        WHERE l.owner_id = ${ownerId} AND a2.is_liquid AND a2.deleted_at IS NULL AND a2.archived_at IS NULL
          AND a2.tracking_start_date <= ${asOf}::date AND t.occurred_at < ${endOfAsOf}
      ), 0) AS total
      FROM bank_accounts a
      WHERE a.owner_id = ${ownerId} AND a.is_liquid AND a.deleted_at IS NULL AND a.archived_at IS NULL
        AND a.tracking_start_date <= ${asOf}::date
    `.execute(this.db);
    const liquid = money(balanceRow.rows[0].total);

    // 2. Scheduled payments: reservations that were open at the end of asOf and fall due this month.
    const openAtAsOf = (q: any) =>
      q
        .where('r.owner_id', '=', ownerId)
        .where('r.created_at', '<', endOfAsOf)
        .where((eb: any) => eb.or([eb('r.status', '=', 'active'), eb('r.closed_at', '>=', endOfAsOf)]));
    const reservations = await openAtAsOf(this.db.selectFrom('money_reservations as r').select(['r.name', 'r.target_amount', 'r.reserved_amount', 'r.due_date', 'r.commitment_id', 'r.occurrence_date']))
      .where('r.due_date', '<', nextMonth)
      .orderBy('r.due_date')
      .execute();
    const scheduled: Item[] = reservations.map((r: any) => ({ name: r.name, amount: fmt(r.target_amount), date: r.due_date < asOf ? asOf : r.due_date }));
    const commitments = await this.db.selectFrom('financial_commitments').selectAll().where('owner_id', '=', ownerId).where('status', '=', 'active').where('created_at', '<', endOfAsOf).execute();
    const reservedOccurrences = new Set(reservations.filter((r: any) => r.commitment_id).map((r: any) => `${r.commitment_id}|${r.occurrence_date}`));
    for (const c of commitments) {
      // Further occurrences this month beyond the ones already reserved.
      let d = nextOccurrence(c.next_due_date, c.frequency, c.interval_count, c.anchor_day);
      while (d && d < nextMonth) {
        if (d > asOf && !reservedOccurrences.has(`${c.id}|${d}`)) scheduled.push({ name: c.name, amount: fmt(c.amount), date: d });
        d = nextOccurrence(d, c.frequency, c.interval_count, c.anchor_day);
      }
    }

    // Spending already represented by a commitment or reservation must not be counted again.
    const settledIds = this.db.selectFrom('reservation_settlements').select('transaction_id').where('owner_id', '=', ownerId).where('status', '=', 'active');
    const commitmentCategories = new Set(commitments.map((c) => c.category_id).filter(Boolean));
    const commitmentNames = new Set(commitments.map((c) => c.name.trim().toLowerCase()));

    // 3. Recurring income / expenses seen last month that have not happened yet this month (by asOf).
    const recurring = await this.db
      .selectFrom('transactions as t')
      .select(['t.type', 't.amount', 't.category_id', 't.merchant', 't.source_name', 't.description', IST_DATE.as('day')])
      .where('t.owner_id', '=', ownerId)
      .where('t.status', '=', 'confirmed')
      .where('t.deleted_at', 'is', null)
      .where('t.is_recurring', '=', true)
      .where('t.type', 'in', ['income', 'expense'])
      .where('t.id', 'not in', settledIds)
      .where('t.occurred_at', '>=', startOf(lastMonthStart))
      .where('t.occurred_at', '<', endOfAsOf)
      .execute();
    const key = (t: (typeof recurring)[number]) => `${t.type}|${t.category_id ?? ''}|${(t.merchant ?? t.source_name ?? '').toLowerCase()}`;
    const seenThisMonth = new Set(recurring.filter((t) => t.day >= monthStart).map(key));
    const expectedIncome: Item[] = [];
    const expectedExpenses: Item[] = [];
    const skippedAsCommitment: string[] = [];
    for (const t of recurring.filter((x) => x.day < monthStart)) {
      if (seenThisMonth.has(key(t))) continue;
      const date = addMonths(t.day, 1, Number(t.day.slice(8, 10)));
      if (date <= asOf || date > monthEnd) continue;
      const name = t.merchant ?? t.source_name ?? t.description ?? (t.type === 'income' ? 'Recurring income' : 'Recurring expense');
      if (t.type === 'expense' && ((t.category_id && commitmentCategories.has(t.category_id)) || commitmentNames.has(name.trim().toLowerCase()))) {
        skippedAsCommitment.push(name);
        continue;
      }
      (t.type === 'income' ? expectedIncome : expectedExpenses).push({ name, amount: fmt(t.amount), date });
    }

    // 4. Variable spending: non-recurring, unplanned expenses not linked to a reservation, weighted toward recent days.
    const ranges = windowRanges(asOf);
    const historyFrom = ranges[2].start;
    const variable = this.db
      .selectFrom('transactions as t')
      .where('t.owner_id', '=', ownerId)
      .where('t.type', '=', 'expense')
      .where('t.status', '=', 'confirmed')
      .where('t.deleted_at', 'is', null)
      .where('t.is_recurring', '=', false)
      .where((eb) => eb.or([eb('t.is_planned', 'is', null), eb('t.is_planned', '=', false)]))
      .where('t.id', 'not in', settledIds);
    const first = await variable.select(sql<string | null>`MIN(${IST_DATE})`.as('first_day')).where('t.occurred_at', '>=', startOf(historyFrom)).where('t.occurred_at', '<', startOf(asOf)).executeTakeFirstOrThrow();
    const windowTotals: Decimal[] = [];
    for (const r of ranges) {
      const row = await variable.select(sql<string>`COALESCE(SUM(t.amount), 0)`.as('total')).where('t.occurred_at', '>=', startOf(r.start)).where('t.occurred_at', '<', startOf(r.end)).executeTakeFirstOrThrow();
      windowTotals.push(money(row.total));
    }
    const spend = weightedDailySpend({ asOf, firstDay: first.first_day, windowTotals, weights: this.config.forecastWeights });
    const variableTotal = spend.dailyAverage.times(daysLeft);

    const total = (items: Item[]) => items.reduce((acc, i) => acc.plus(i.amount), new Decimal(0));
    const income = total(expectedIncome);
    const payments = total(scheduled);
    const recurringOut = total(expectedExpenses);
    const monthEndBalance = liquid.plus(income).minus(payments).minus(recurringOut).minus(variableTotal);

    // Still held at month end: reservations due later + reserve-mode goal savings (as of asOf).
    const later = await openAtAsOf(this.db.selectFrom('money_reservations as r').select(sql<string>`COALESCE(SUM(r.reserved_amount), 0)`.as('total')))
      .where('r.due_date', '>=', nextMonth)
      .executeTakeFirstOrThrow();
    const goals = await this.db
      .selectFrom('goal_contributions as c')
      .innerJoin('financial_goals as g', 'g.id', 'c.goal_id')
      .leftJoin('bank_accounts as a', 'a.id', 'g.account_id')
      .select(sql<string>`COALESCE(SUM(c.amount), 0)`.as('total'))
      .where('g.owner_id', '=', ownerId)
      .where('g.status', '!=', 'archived')
      .where('g.allocation_mode', '=', 'reserve')
      .where('c.contributed_on', '<=', asOf)
      .where((eb) => eb.or([eb('g.account_id', 'is', null), eb('a.is_liquid', '=', true)]))
      .executeTakeFirstOrThrow();
    const availableAtMonthEnd = monthEndBalance.minus(later.total).minus(goals.total);
    // Available-to-spend at the end of asOf, using the same as-of reconstruction, for comparison.
    const reservedThisMonth = reservations.reduce((acc: Decimal, r: any) => acc.plus(r.reserved_amount), new Decimal(0));
    const availableNow = liquid.minus(reservedThisMonth).minus(later.total).minus(goals.total);

    const [w1, w2, w3] = this.config.forecastWeights;
    const assumptions = [
      `Starting balance is your liquid balance at the end of ${asOf} (savings, current, cash, UPI-linked and wallet accounts). Fixed deposits and credit cards are not included.`,
      'Every reservation that was open on that date and falls due this month is paid in full on its due date; overdue ones are assumed paid on the forecast date.',
      'Recurring income and expenses are items you marked as recurring last month that have not occurred yet this month. They are expected on the same day of the month.',
      skippedAsCommitment.length
        ? `Recurring expenses that match a commitment (${skippedAsCommitment.join(', ')}) are counted once, as scheduled payments.`
        : 'Recurring expenses that match a commitment are counted once, as scheduled payments.',
      spend.method === 'weighted_recent'
        ? `Day-to-day spending continues at ₹${fmt(spend.dailyAverage)} per day: a weighted average of the last 7 days (${w1 * 100}%), days 8–30 (${w2 * 100}%) and days 31–90 (${w3 * 100}%), using ${spend.historyDays} day(s) of history.`
        : spend.method === 'simple_average'
          ? `Day-to-day spending continues at ₹${fmt(spend.dailyAverage)} per day, a simple average of your ${spend.historyDays} day(s) of history (too short to weight).`
          : 'No spending history yet, so day-to-day spending is assumed to be ₹0. The forecast will improve as you record expenses.',
      'Planned spending, recurring items and reservation payments are excluded from day-to-day spending so they are not counted twice.',
      'Goal savings and future reservations are not spent; they reduce what is available, not your balance.',
    ];
    if (asOf < now) assumptions.push('This is a historical forecast rebuilt from your current records; later edits to past transactions are reflected.');

    return {
      methodVersion: FORECAST_METHOD_VERSION,
      asOf,
      calculatedAt: new Date().toISOString(),
      monthEnd,
      daysLeft,
      currency: 'INR',
      startingLiquidBalance: fmt(liquid),
      expectedIncome: { total: fmt(income), items: expectedIncome },
      scheduledPayments: { total: fmt(payments), items: scheduled.sort((a, b) => a.date.localeCompare(b.date)) },
      expectedRecurringExpenses: { total: fmt(recurringOut), items: expectedExpenses },
      variableSpending: {
        total: fmt(variableTotal),
        dailyAverage: fmt(spend.dailyAverage),
        method: spend.method,
        historyDays: spend.historyDays,
        windows: spend.windows.map((w) => ({ label: w.label, coveredDays: w.coveredDays, total: fmt(w.total), dailyAverage: fmt(w.dailyAverage), weight: Number(w.weight.toFixed(4)) })),
      },
      estimatedMonthEndBalance: fmt(monthEndBalance),
      estimatedAvailableAtMonthEnd: fmt(availableAtMonthEnd),
      /** Available-to-spend at the end of asOf (today by default). */
      availableNow: fmt(availableNow),
      /** estimatedAvailableAtMonthEnd − availableNow: how much the spendable amount is expected to change. */
      availableChangeByMonthEnd: fmt(availableAtMonthEnd.minus(availableNow)),
      shortfallRisk: monthEndBalance.isNegative(),
      confidence: spend.historyDays >= 90 ? 'high' : spend.historyDays >= 30 ? 'medium' : 'low',
      formula: 'startingLiquidBalance + expectedIncome − scheduledPayments − expectedRecurringExpenses − variableSpending',
      assumptions,
    };
  }
}

@ApiTags('forecast')
@ApiBearerAuth()
@Controller('forecast')
export class ForecastController {
  constructor(private readonly forecast: ForecastService) {}

  @Get('month-end') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ) @ApiOkResponse({ type: ForecastResponse })
  @ApiOperation({ summary: 'Estimated month-end balance with the method, assumptions and confidence behind it' })
  monthEnd(@CurrentUser() user: AuthUser, @Query() q: AsOfQuery) {
    return this.forecast.monthEnd(user, q.asOf);
  }
}
