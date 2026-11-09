import { Controller, Get, HttpStatus, Inject, Injectable, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { sql } from 'kysely';
import Decimal from 'decimal.js';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { addMonths, today } from '../common/dates';
import { DomainError } from '../common/errors';
import { fmt, money } from '../common/money';
import { DATABASE } from '../database/database.module';
import type { DB } from '../database/schema';
import { PERMISSIONS } from '../rbac/permissions';
import { MonthlyReportResponse } from '../api-responses';

export class MonthQuery {
  @ApiPropertyOptional({ example: '2026-11', description: 'Calendar month (India time). Defaults to the current month.' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Enter a month as YYYY-MM.' })
  month?: string;
}

const pct = (part: Decimal, whole: Decimal) => (whole.isZero() ? '0.00' : part.div(whole).times(100).toDecimalPlaces(2).toFixed(2));

/**
 * Monthly report. Every figure is computed here from confirmed, non-deleted income and expense
 * transactions (historical imports included, transfers never), so clients only display results.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DATABASE) private readonly db: DB) {}

  async monthly(user: AuthUser, monthInput?: string) {
    const month = monthInput ?? today().slice(0, 7);
    if (month > today().slice(0, 7)) throw new DomainError('report_future_month', 'Choose this month or an earlier one.', HttpStatus.UNPROCESSABLE_ENTITY);
    const start = `${month}-01`;
    const end = addMonths(start, 1, 1);
    const prevStart = addMonths(start, -1, 1);
    const ownerId = user.userId;
    const window = (from: string, to: string) =>
      this.db
        .selectFrom('transactions as t')
        .where('t.owner_id', '=', ownerId)
        .where('t.status', '=', 'confirmed')
        .where('t.deleted_at', 'is', null)
        .where('t.type', 'in', ['income', 'expense'])
        .where('t.occurred_at', '>=', new Date(`${from}T00:00:00+05:30`))
        .where('t.occurred_at', '<', new Date(`${to}T00:00:00+05:30`));

    const totals = async (from: string, to: string) => {
      const r = await window(from, to)
        .select([
          sql<string>`COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)`.as('income'),
          sql<string>`COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)`.as('expenses'),
          sql<string>`COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense' AND t.is_essential IS TRUE), 0)`.as('essential'),
          sql<string>`COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense' AND t.is_essential IS FALSE), 0)`.as('non_essential'),
          sql<string>`COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense' AND t.is_planned IS TRUE), 0)`.as('planned'),
          sql<string>`COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense' AND t.is_planned IS NOT TRUE), 0)`.as('unplanned'),
          sql<string>`COUNT(*) FILTER (WHERE t.type = 'expense')`.as('expense_count'),
        ])
        .executeTakeFirstOrThrow();
      return { income: money(r.income), expenses: money(r.expenses), essential: money(r.essential), nonEssential: money(r.non_essential), planned: money(r.planned), unplanned: money(r.unplanned), count: Number(r.expense_count) };
    };

    const cur = await totals(start, end);
    const prev = await totals(prevStart, start);

    const byCategory = async (kind: 'income' | 'expense') =>
      window(start, end)
        .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
        .where('t.type', '=', kind)
        .select(['t.category_id', sql<string>`COALESCE(c.name, 'Uncategorised')`.as('name'), sql<string>`SUM(t.amount)`.as('total'), sql<string>`COUNT(*)`.as('n')])
        .groupBy(['t.category_id', 'c.name'])
        .orderBy(sql`SUM(t.amount)`, 'desc')
        .execute();
    const expenseCats = await byCategory('expense');
    const incomeCats = await byCategory('income');

    const top = await window(start, end)
      .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
      .where('t.type', '=', 'expense')
      .select(['t.id', 't.amount', 't.merchant', 't.description', 't.occurred_at', 'c.name as category'])
      .orderBy('t.amount', 'desc')
      .orderBy('t.occurred_at', 'desc')
      .limit(5)
      .execute();

    const net = cur.income.minus(cur.expenses);
    const change = (a: Decimal, b: Decimal) => fmt(a.minus(b));
    return {
      month,
      periodStart: start,
      periodEnd: end,
      currency: 'INR',
      income: fmt(cur.income),
      expenses: fmt(cur.expenses),
      net: fmt(net),
      savingsRatePercent: cur.income.isZero() ? null : pct(Decimal.max(net, 0), cur.income),
      expenseCount: cur.count,
      essential: fmt(cur.essential),
      nonEssential: fmt(cur.nonEssential),
      planned: fmt(cur.planned),
      unplanned: fmt(cur.unplanned),
      expensesByCategory: expenseCats.map((c) => ({ categoryId: c.category_id, name: c.name, total: fmt(c.total), sharePercent: pct(money(c.total), cur.expenses), count: Number(c.n) })),
      incomeByCategory: incomeCats.map((c) => ({ categoryId: c.category_id, name: c.name, total: fmt(c.total), sharePercent: pct(money(c.total), cur.income), count: Number(c.n) })),
      largestExpenses: top.map((t) => ({ id: t.id, amount: fmt(t.amount), label: t.merchant ?? t.description ?? t.category ?? 'Expense', category: t.category, occurredAt: new Date(t.occurred_at).toISOString() })),
      previousMonth: {
        month: prevStart.slice(0, 7),
        income: fmt(prev.income),
        expenses: fmt(prev.expenses),
        incomeChange: change(cur.income, prev.income),
        expensesChange: change(cur.expenses, prev.expenses),
      },
      notes: [
        'Only confirmed income and expenses are counted. Transfers between your own accounts, and credit card bill payments, are not.',
        'Savings rate is (income − expenses) ÷ income, shown as 0% when you spent more than you earned.',
        'Months follow India time.',
      ],
    };
  }
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('monthly') @RequirePermissions(PERMISSIONS.FINANCE_OWN_READ) @ApiOkResponse({ type: MonthlyReportResponse })
  @ApiOperation({ summary: 'Income, spending by category, essential vs non-essential and comparison with the previous month' })
  monthly(@CurrentUser() user: AuthUser, @Query() q: MonthQuery) {
    return this.reports.monthly(user, q.month);
  }
}
