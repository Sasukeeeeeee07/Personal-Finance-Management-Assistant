import { Controller, Get, Inject, Injectable, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'kysely';
import Decimal from 'decimal.js';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { addDays, addMonths, daysBetween, monthRange, nextOccurrence, today } from '../common/dates';
import { fmt, money } from '../common/money';
import { DATABASE } from '../database/database.module';
import type { DB } from '../database/schema';
import { AsOfQuery } from '../budgets/budget.dto';
import { FinancialSummaryService } from '../dashboard/financial-summary.service';
import { PERMISSIONS } from '../rbac/permissions';

const IST_DATE = sql<string>`to_char(occurred_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;
const HISTORY_DAYS = 90;

interface Item {
  name: string;
  amount: string;
  date: string;
}

/**
 * Deterministic month-end forecast (D-014). Every figure comes with the rule that produced it.
 *
 *   estimatedMonthEndBalance = liquid balance
 *                            + expected recurring income
 *                            − scheduled payments (reservations + further commitment occurrences)
 *                            − expected recurring expenses not covered by a commitment
 *                            − average daily variable spending × days left
 */
@Injectable()
export class ForecastService {
  constructor(
    @Inject(DATABASE) private readonly db: DB,
    private readonly summary: FinancialSummaryService,
  ) {}

  async monthEnd(user: AuthUser, asOf = today()) {
    const ownerId = user.userId;
    const { monthStart } = monthRange(asOf);
    const nextMonth = addMonths(monthStart, 1, 1);
    const monthEnd = addDays(nextMonth, -1);
    const daysLeft = daysBetween(asOf, nextMonth) - 1; // full days after today
    const lastMonthStart = addMonths(monthStart, -1, 1);

    const position = await this.summary.spendable(ownerId);

    // 1. Scheduled payments: open reservations due by month end, plus later occurrences of commitments this month.
    const reservations = await this.db
      .selectFrom('money_reservations')
      .select(['name', 'target_amount', 'due_date', 'commitment_id'])
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'active')
      .where('due_date', '<', nextMonth)
      .orderBy('due_date')
      .execute();
    const scheduled: Item[] = reservations.map((r) => ({ name: r.name, amount: fmt(r.target_amount), date: r.due_date < asOf ? asOf : r.due_date }));
    const commitments = await this.db.selectFrom('financial_commitments').selectAll().where('owner_id', '=', ownerId).where('status', '=', 'active').execute();
    for (const c of commitments) {
      let d = nextOccurrence(c.next_due_date, c.frequency, c.interval_count, c.anchor_day);
      while (d && d < nextMonth) {
        scheduled.push({ name: c.name, amount: fmt(c.amount), date: d });
        d = nextOccurrence(d, c.frequency, c.interval_count, c.anchor_day);
      }
    }

    // Transactions that settled a reservation are commitments, not variable or "recurring" spending.
    const settledIds = this.db.selectFrom('money_reservations').select('transaction_id').where('owner_id', '=', ownerId).where('transaction_id', 'is not', null);

    // 2 & 3. Recurring income / expenses seen last month that have not happened yet this month.
    const recurring = await this.db
      .selectFrom('transactions')
      .select(['type', 'amount', 'category_id', 'merchant', 'source_name', 'description', IST_DATE.as('day')])
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'confirmed')
      .where('deleted_at', 'is', null)
      .where('is_recurring', '=', true)
      .where('type', 'in', ['income', 'expense'])
      .where('id', 'not in', settledIds)
      .where('occurred_at', '>=', new Date(`${lastMonthStart}T00:00:00+05:30`))
      .where('occurred_at', '<', new Date(`${nextMonth}T00:00:00+05:30`))
      .execute();
    const key = (t: (typeof recurring)[number]) => `${t.type}|${t.category_id ?? ''}|${(t.merchant ?? t.source_name ?? '').toLowerCase()}`;
    const seenThisMonth = new Set(recurring.filter((t) => t.day >= monthStart).map(key));
    const expectedIncome: Item[] = [];
    const expectedExpenses: Item[] = [];
    for (const t of recurring.filter((t) => t.day < monthStart)) {
      if (seenThisMonth.has(key(t))) continue;
      const date = addMonths(t.day, 1, Number(t.day.slice(8, 10)));
      if (date <= asOf || date > monthEnd) continue; // already due (and missing) or outside this month
      const item = { name: t.merchant ?? t.source_name ?? t.description ?? (t.type === 'income' ? 'Recurring income' : 'Recurring expense'), amount: fmt(t.amount), date };
      (t.type === 'income' ? expectedIncome : expectedExpenses).push(item);
    }

    // 4. Variable spending: average daily non-recurring expense over the last 90 days (excluding today).
    const historyStart = addDays(asOf, -HISTORY_DAYS);
    const variable = await this.db
      .selectFrom('transactions')
      .select([sql<string>`COALESCE(SUM(amount), 0)`.as('total'), sql<string | null>`MIN(${IST_DATE})`.as('first_day')])
      .where('owner_id', '=', ownerId)
      .where('type', '=', 'expense')
      .where('status', '=', 'confirmed')
      .where('deleted_at', 'is', null)
      .where('is_recurring', '=', false)
      .where('id', 'not in', settledIds)
      .where('occurred_at', '>=', new Date(`${historyStart}T00:00:00+05:30`))
      .where('occurred_at', '<', new Date(`${asOf}T00:00:00+05:30`))
      .executeTakeFirstOrThrow();
    // Average over the days we actually have history for, so a new user is not diluted by empty days.
    const historyDays = variable.first_day ? Math.min(daysBetween(variable.first_day, asOf), HISTORY_DAYS) : 0;
    const dailyVariable = historyDays > 0 ? money(variable.total).div(historyDays).toDecimalPlaces(2) : new Decimal(0);
    const variableTotal = dailyVariable.times(daysLeft);

    const total = (items: Item[]) => items.reduce((acc, i) => acc.plus(i.amount), new Decimal(0));
    const income = total(expectedIncome);
    const payments = total(scheduled);
    const recurringOut = total(expectedExpenses);
    const monthEndBalance = position.liquidBalance.plus(income).minus(payments).minus(recurringOut).minus(variableTotal);

    const laterReserved = await this.db
      .selectFrom('money_reservations')
      .select(sql<string>`COALESCE(SUM(reserved_amount), 0)`.as('total'))
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'active')
      .where('due_date', '>=', nextMonth)
      .executeTakeFirstOrThrow();
    const availableAtMonthEnd = monthEndBalance.minus(laterReserved.total).minus(position.allocated);

    const assumptions = [
      'Only liquid accounts (savings, current, cash, UPI-linked, wallets) are included. Fixed deposits and credit cards are not.',
      'Every open reservation due this month is paid in full on its due date; overdue ones are assumed to be paid today.',
      'Recurring income and expenses are those you marked as recurring last month and have not received or paid yet this month. They are expected on the same day of the month.',
      historyDays > 0
        ? `Day-to-day spending continues at your average of ₹${fmt(dailyVariable)} per day, based on the last ${historyDays} day(s) of non-recurring expenses.`
        : 'No spending history yet, so day-to-day spending is assumed to be ₹0. The forecast will improve as you record expenses.',
      'Goal savings and future reservations are not spent; they reduce what is available, not your balance.',
    ];

    return {
      asOf,
      monthEnd,
      daysLeft,
      currency: 'INR',
      startingLiquidBalance: fmt(position.liquidBalance),
      expectedIncome: { total: fmt(income), items: expectedIncome },
      scheduledPayments: { total: fmt(payments), items: scheduled.sort((a, b) => a.date.localeCompare(b.date)) },
      expectedRecurringExpenses: { total: fmt(recurringOut), items: expectedExpenses },
      variableSpending: { total: fmt(variableTotal), dailyAverage: fmt(dailyVariable), historyDays },
      estimatedMonthEndBalance: fmt(monthEndBalance),
      estimatedAvailableAtMonthEnd: fmt(availableAtMonthEnd),
      shortfallRisk: monthEndBalance.isNegative(),
      confidence: historyDays >= 60 ? 'medium' : 'low',
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

  @Get('month-end') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ)
  @ApiOperation({ summary: 'Estimated month-end balance with the assumptions behind it' })
  monthEnd(@CurrentUser() user: AuthUser, @Query() q: AsOfQuery) {
    return this.forecast.monthEnd(user, q.asOf);
  }
}
