import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import Decimal from 'decimal.js';
import { AuthUser } from '../common/auth-context';
import { monthRange, today } from '../common/dates';
import { fmt, money } from '../common/money';
import { DATABASE } from '../database/database.module';
import type { DB, Executor } from '../database/schema';
import { LedgerService } from '../transactions/ledger.service';

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
    const allocated = new Decimal(0); // Goal allocations arrive with the goals module (Phase 3).
    return { liquidBalance, reserved, allocated, available: liquidBalance.minus(reserved).minus(allocated) };
  }

  async summary(user: AuthUser, asOf = today()) {
    const ownerId = user.userId;
    const accounts = await this.db.selectFrom('bank_accounts').select(['id', 'is_liquid', 'is_liability', 'type']).where('owner_id', '=', ownerId).where('deleted_at', 'is', null).where('archived_at', 'is', null).execute();
    const balances = await this.ledger.balances(this.db, ownerId);
    const pos = await this.spendable(ownerId);

    const assets = accounts.filter((a) => !a.is_liability).reduce((acc, a) => acc.plus(balances.get(a.id) ?? 0), new Decimal(0));
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
    return {
      asOf,
      currency: 'INR',
      totalBalance: fmt(assets),
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
        ],
      },
    };
  }
}
