import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import Decimal from 'decimal.js';
import { AuthUser } from '../common/auth-context';
import { monthRange, today } from '../common/dates';
import { fmt, money } from '../common/money';
import { DATABASE } from '../database/database.module';
import type { DB, Executor } from '../database/schema';
import { LedgerService } from '../transactions/ledger.service';
import { BudgetsService } from '../budgets/budgets.service';

export interface SpendablePosition {
  liquidBalance: Decimal;
  reserved: Decimal;
  allocated: Decimal;
  available: Decimal;
}

@Injectable()
export class FinancialSummaryService {
  constructor(
    @Inject(DATABASE) private readonly db: DB,
    private readonly ledger: LedgerService,
    private readonly budgets: BudgetsService,
  ) {}

  /** available-to-spend = liquid balance − active reservations − other allocated funds */
  async spendable(ownerId: string, db: Executor = this.db): Promise<SpendablePosition> {
    const accounts = await db.selectFrom('bank_accounts').select(['id', 'is_liquid']).where('owner_id', '=', ownerId).where('deleted_at', 'is', null).where('archived_at', 'is', null).execute();
    const balances = await this.ledger.balances(db, ownerId);
    const liquidBalance = accounts.filter((a) => a.is_liquid).reduce((acc, a) => acc.plus(balances.get(a.id) ?? 0), new Decimal(0));
    const r = await db
      .selectFrom('money_reservations')
      .select(sql<string>`COALESCE(SUM(reserved_amount), 0)`.as('total'))
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    const reserved = money(r.total);
    const allocated = await this.goalAllocations(ownerId, db);
    return { liquidBalance, reserved, allocated, available: liquidBalance.minus(reserved).minus(allocated) };
  }

  /**
   * Money earmarked for savings goals in reserve mode (D-009, D-015). Track-only goals do not reduce
   * available-to-spend. Goals kept in a non-liquid account (e.g. a fixed
   * deposit) are excluded because that money is already outside the liquid balance.
   */
  async goalAllocations(ownerId: string, db: Executor = this.db): Promise<Decimal> {
    const r = await db
      .selectFrom('goal_contributions as c')
      .innerJoin('financial_goals as g', 'g.id', 'c.goal_id')
      .leftJoin('bank_accounts as a', 'a.id', 'g.account_id')
      .select(sql<string>`COALESCE(SUM(c.amount), 0)`.as('total'))
      .where('g.owner_id', '=', ownerId)
      .where('g.status', '!=', 'archived')
      .where('g.allocation_mode', '=', 'reserve')
      .where((eb) => eb.or([eb('g.account_id', 'is', null), eb('a.is_liquid', '=', true)]))
      .executeTakeFirstOrThrow();
    return money(r.total);
  }

  /** Total saved across all non-archived goals, wherever the money is kept. */
  async totalSaved(ownerId: string): Promise<Decimal> {
    const r = await this.db
      .selectFrom('goal_contributions as c')
      .innerJoin('financial_goals as g', 'g.id', 'c.goal_id')
      .select(sql<string>`COALESCE(SUM(c.amount), 0)`.as('total'))
      .where('g.owner_id', '=', ownerId)
      .where('g.status', '!=', 'archived')
      .executeTakeFirstOrThrow();
    return money(r.total);
  }

  async summary(user: AuthUser, asOf = today()) {
    const ownerId = user.userId;
    const accounts = await this.db.selectFrom('bank_accounts').select(['id', 'is_liquid', 'is_liability', 'type']).where('owner_id', '=', ownerId).where('deleted_at', 'is', null).where('archived_at', 'is', null).execute();
    const balances = await this.ledger.balances(this.db, ownerId);
    const pos = await this.spendable(ownerId);

    const assets = accounts.filter((a) => !a.is_liability).reduce((acc, a) => acc.plus(balances.get(a.id) ?? 0), new Decimal(0));
    // Net position: every account balance, with liabilities (card dues) negative.
    const netPosition = accounts.reduce((acc, a) => acc.plus(balances.get(a.id) ?? 0), new Decimal(0));
    const cardOutstanding = accounts
      .filter((a) => a.is_liability)
      .reduce((acc, a) => acc.plus(Decimal.max((balances.get(a.id) ?? new Decimal(0)).neg(), 0)), new Decimal(0));

    const { from, to } = monthRange(asOf);
    const flows = await this.db
      .selectFrom('transactions')
      .select([
        sql<string>`COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)`.as('income'),
        sql<string>`COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0)`.as('expenses'),
      ])
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'confirmed')
      .where('deleted_at', 'is', null)
      .where('occurred_at', '>=', new Date(from))
      .where('occurred_at', '<', new Date(to))
      .executeTakeFirstOrThrow();

    const review = await this.db
      .selectFrom('transactions')
      .select(sql<string>`COUNT(*)`.as('n'))
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'needs_review')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();

    const upcoming = await this.db
      .selectFrom('money_reservations')
      .select(['id', 'name', 'target_amount', 'reserved_amount', 'due_date', 'account_id'])
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'active')
      .orderBy('due_date')
      .limit(10)
      .execute();

    const income = money(flows.income);
    const expenses = money(flows.expenses);
    const savings = await this.totalSaved(ownerId);
    const budget = await this.budgets.overallMonthly(ownerId, asOf);
    return {
      asOf,
      currency: 'INR',
      totalBalance: fmt(assets),
      netPosition: fmt(netPosition),
      liquidBalance: fmt(pos.liquidBalance),
      reserved: fmt(pos.reserved),
      allocated: fmt(pos.allocated),
      availableToSpend: fmt(pos.available),
      overcommitted: pos.available.isNegative(),
      creditCardOutstanding: fmt(cardOutstanding),
      monthIncome: fmt(income),
      monthExpenses: fmt(expenses),
      monthNet: fmt(income.minus(expenses)),
      needsReviewCount: Number(review.n),
      savings: fmt(savings),
      monthlyBudget: budget
        ? { budgetId: budget.id, limit: budget.current.limit, spent: budget.current.spent, remaining: budget.current.remaining, utilizationPercent: budget.current.utilizationPercent, dailyTarget: budget.current.dailyTarget }
        : null,
      upcomingPayments: upcoming.map((u) => ({
        reservationId: u.id,
        name: u.name,
        amount: u.target_amount,
        reserved: u.reserved_amount,
        dueDate: u.due_date,
        accountId: u.account_id,
        overdue: u.due_date < asOf,
      })),
      calculation: {
        formula: 'availableToSpend = liquidBalance − reserved − allocated',
        notes: [
          'Liquid balance includes savings, current, cash, UPI-linked and wallet accounts. Fixed deposits and credit cards are excluded.',
          'Reserved money is a plan inside this app. It is not blocked or frozen at your bank.',
          'Transfers between your own accounts are not counted as income or expenses.',
          'Credit card dues are shown separately. Create a commitment for your card bill to reserve money for it.',
          'Net position is the total of all your accounts, including fixed deposits, minus credit card dues.',
          'Allocated is money saved in goals set to reserve, except goals kept in a non-liquid account such as a fixed deposit. Track-only goals are not subtracted.',
        ],
      },
    };
  }
}
