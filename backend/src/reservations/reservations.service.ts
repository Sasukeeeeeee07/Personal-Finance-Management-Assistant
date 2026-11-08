import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';
import { AuthUser } from '../common/auth-context';
import { nextOccurrence, today } from '../common/dates';
import { DomainError, notFound } from '../common/errors';
import { fmt, money } from '../common/money';
import { DATABASE } from '../database/database.module';
import type { DB, Executor, MoneyReservationsTable, TransactionsTable } from '../database/schema';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { CategoriesService } from '../categories/categories';
import { FinancialSummaryService } from '../dashboard/financial-summary.service';
import { AdjustReservationDto, CreateCommitmentDto, CreateReservationDto, SettleReservationDto } from './dto/reservation.dto';

type ReservationRow = Selectable<MoneyReservationsTable>;
type TxnRow = Selectable<TransactionsTable>;

export function presentReservation(r: ReservationRow, asOf = today()) {
  const reserved = money(r.reserved_amount);
  const target = money(r.target_amount);
  return {
    id: r.id,
    commitmentId: r.commitment_id,
    accountId: r.account_id,
    name: r.name,
    targetAmount: r.target_amount,
    reservedAmount: r.reserved_amount,
    shortfall: fmt(target.minus(reserved)),
    fullyReserved: reserved.gte(target),
    dueDate: r.due_date,
    status: r.status,
    overdue: r.status === 'active' && r.due_date < asOf,
    transactionId: r.transaction_id,
    settledAmount: r.settled_amount,
    variance: r.variance,
    closedAt: r.closed_at,
  };
}

/**
 * Money Reservation / Money Lock. Reservations are virtual allocations inside this app:
 * they reduce available-to-spend but never move or freeze money at the bank.
 */
@Injectable()
export class ReservationsService {
  constructor(
    @Inject(DATABASE) private readonly db: DB,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
    private readonly summary: FinancialSummaryService,
    private readonly audit: AuditService,
  ) {}

  // --- commitments ---------------------------------------------------------------------------

  async createCommitment(user: AuthUser, dto: CreateCommitmentDto) {
    const reserve = money(dto.reserveAmount ?? dto.amount);
    if (reserve.gt(dto.amount)) throw new DomainError('reserve_exceeds_amount', 'You can reserve up to the commitment amount.');
    return this.db.transaction().execute(async (trx) => {
      const account = await this.accounts.findOwned(trx, user.userId, dto.accountId);
      if (dto.categoryId) await this.categories.assertUsable(trx, user.userId, dto.categoryId, 'expense');
      const commitment = await trx
        .insertInto('financial_commitments')
        .values({
          owner_id: user.userId,
          organization_id: user.organizationId,
          name: dto.name.trim(),
          amount: fmt(dto.amount),
          currency: account.currency,
          account_id: account.id,
          category_id: dto.categoryId ?? null,
          frequency: dto.frequency,
          interval_count: dto.intervalCount ?? 1,
          next_due_date: dto.dueDate,
          anchor_day: Number(dto.dueDate.slice(8, 10)),
          reminder_days_before: dto.reminderDaysBefore ?? 3,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const reservation = await this.insertReservation(trx, user, {
        commitmentId: commitment.id,
        accountId: account.id,
        name: commitment.name,
        target: commitment.amount,
        reserved: fmt(reserve),
        dueDate: commitment.next_due_date,
      });
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'financial_commitment', entityId: commitment.id, action: 'created', after: commitment });
      return { commitment: this.presentCommitment(commitment), reservation: presentReservation(reservation), position: await this.position(trx, user.userId) };
    });
  }

  async listCommitments(user: AuthUser) {
    const rows = await this.db.selectFrom('financial_commitments').selectAll().where('owner_id', '=', user.userId).where('status', '=', 'active').orderBy('next_due_date').execute();
    return rows.map((c) => this.presentCommitment(c));
  }

  /** Cancelling a commitment releases its open reservation back into available-to-spend. */
  async cancelCommitment(user: AuthUser, id: string) {
    return this.db.transaction().execute(async (trx) => {
      const c = await trx.selectFrom('financial_commitments').selectAll().where('id', '=', id).where('owner_id', '=', user.userId).forUpdate().executeTakeFirst();
      if (!c) throw notFound('Commitment');
      if (c.status !== 'active') throw new DomainError('commitment_not_active', 'This commitment is already closed.', HttpStatus.CONFLICT);
      await trx.updateTable('financial_commitments').set({ status: 'cancelled', updated_at: new Date() }).where('id', '=', id).execute();
      await trx
        .updateTable('money_reservations')
        .set({ status: 'cancelled', closed_at: new Date(), updated_at: new Date() })
        .where('commitment_id', '=', id)
        .where('status', '=', 'active')
        .execute();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'financial_commitment', entityId: id, action: 'cancelled' });
      return { position: await this.position(trx, user.userId) };
    });
  }

  // --- reservations --------------------------------------------------------------------------

  async list(user: AuthUser, status?: ReservationRow['status']) {
    let q = this.db.selectFrom('money_reservations').selectAll().where('owner_id', '=', user.userId);
    if (status) q = q.where('status', '=', status);
    const rows = await q.orderBy('due_date').execute();
    return rows.map((r) => presentReservation(r));
  }

  async create(user: AuthUser, dto: CreateReservationDto) {
    const reserved = money(dto.reservedAmount ?? dto.targetAmount);
    if (reserved.gt(dto.targetAmount)) throw new DomainError('reserve_exceeds_amount', 'You can reserve up to the target amount.');
    return this.db.transaction().execute(async (trx) => {
      const account = await this.accounts.findOwned(trx, user.userId, dto.accountId);
      const r = await this.insertReservation(trx, user, { commitmentId: null, accountId: account.id, name: dto.name.trim(), target: fmt(dto.targetAmount), reserved: fmt(reserved), dueDate: dto.dueDate });
      return { reservation: presentReservation(r), position: await this.position(trx, user.userId) };
    });
  }

  /** Top up or reduce a partial reservation. */
  async adjust(user: AuthUser, id: string, dto: AdjustReservationDto) {
    return this.db.transaction().execute(async (trx) => {
      const r = await this.findActive(trx, user.userId, id);
      if (money(dto.reservedAmount).gt(r.target_amount)) throw new DomainError('reserve_exceeds_amount', 'You can reserve up to the target amount.');
      const after = await trx.updateTable('money_reservations').set({ reserved_amount: fmt(dto.reservedAmount), updated_at: new Date() }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'money_reservation', entityId: id, action: 'adjusted', before: r, after });
      return { reservation: presentReservation(after), position: await this.position(trx, user.userId) };
    });
  }

  /** Release an unused reservation (e.g. the bill was waived). Money returns to available-to-spend. */
  async release(user: AuthUser, id: string) {
    return this.db.transaction().execute(async (trx) => {
      const r = await this.findActive(trx, user.userId, id);
      const after = await trx.updateTable('money_reservations').set({ status: 'released', closed_at: new Date(), updated_at: new Date() }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'money_reservation', entityId: id, action: 'released', before: r, after });
      if (r.commitment_id) await this.scheduleNext(trx, user, r.commitment_id, r.due_date);
      return { reservation: presentReservation(after), position: await this.position(trx, user.userId) };
    });
  }

  async settleWithExisting(user: AuthUser, id: string, dto: SettleReservationDto) {
    return this.db.transaction().execute(async (trx) => {
      const txn = await trx.selectFrom('transactions').selectAll().where('id', '=', dto.transactionId).where('owner_id', '=', user.userId).where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
      if (!txn) throw notFound('Transaction');
      const reservation = await this.settle(trx, user, id, txn, dto.acceptDifference ?? false);
      return { reservation, position: await this.position(trx, user.userId) };
    });
  }

  /**
   * Reconcile a reservation against the payment that settled it. Must run in the same DB transaction
   * as the payment: the expense lowers the balance while the reservation stops counting as reserved,
   * so available-to-spend drops exactly once.
   */
  async settle(trx: Executor, user: AuthUser, reservationId: string, txn: TxnRow, acceptDifference: boolean) {
    const r = await this.findActive(trx, user.userId, reservationId);
    if (txn.status !== 'confirmed' || (txn.type !== 'expense' && txn.type !== 'transfer')) {
      throw new DomainError('invalid_settlement', 'Only a confirmed expense or bill payment can settle a reservation.');
    }
    const linked = await trx.selectFrom('money_reservations').select('id').where('transaction_id', '=', txn.id).executeTakeFirst();
    if (linked) throw new DomainError('transaction_already_settles', 'This transaction already settles another reservation.', HttpStatus.CONFLICT);

    const paid = money(txn.amount);
    const variance = paid.minus(r.target_amount);
    if (!variance.isZero() && !acceptDifference) {
      throw new DomainError(
        'reservation_amount_mismatch',
        `You reserved ${fmt(r.target_amount)} for ${r.name} but paid ${fmt(paid)}. Review the difference of ${fmt(variance.abs())} and confirm.`,
        HttpStatus.CONFLICT,
        { target: fmt(r.target_amount), reserved: r.reserved_amount, paid: fmt(paid), difference: fmt(variance) },
      );
    }
    const after = await trx
      .updateTable('money_reservations')
      .set({ status: 'reconciled', transaction_id: txn.id, settled_amount: fmt(paid), variance: fmt(variance), closed_at: new Date(), updated_at: new Date() })
      .where('id', '=', r.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'money_reservation', entityId: r.id, action: 'reconciled', before: r, after });
    if (r.commitment_id) await this.scheduleNext(trx, user, r.commitment_id, r.due_date);
    return presentReservation(after);
  }

  /** If the settling payment is deleted or stops being confirmed, the reservation is held again. */
  async reopenForTransaction(trx: Executor, user: AuthUser, transactionId: string) {
    const r = await trx.selectFrom('money_reservations').selectAll().where('transaction_id', '=', transactionId).where('owner_id', '=', user.userId).executeTakeFirst();
    if (!r) return;
    const after = await trx
      .updateTable('money_reservations')
      .set({ status: 'active', transaction_id: null, settled_amount: null, variance: null, closed_at: null, updated_at: new Date() })
      .where('id', '=', r.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'money_reservation', entityId: r.id, action: 'reopened', before: r, after });
  }

  /** Keep settled_amount/variance in sync when the settling payment's amount is corrected. */
  async syncSettledAmount(trx: Executor, transactionId: string, amount: string) {
    const r = await trx.selectFrom('money_reservations').select(['id', 'target_amount']).where('transaction_id', '=', transactionId).executeTakeFirst();
    if (!r) return;
    await trx.updateTable('money_reservations').set({ settled_amount: fmt(amount), variance: fmt(money(amount).minus(r.target_amount)), updated_at: new Date() }).where('id', '=', r.id).execute();
  }

  // --- internals -----------------------------------------------------------------------------

  private async scheduleNext(trx: Executor, user: AuthUser, commitmentId: string, settledDueDate: string) {
    const c = await trx.selectFrom('financial_commitments').selectAll().where('id', '=', commitmentId).forUpdate().executeTakeFirstOrThrow();
    if (c.status !== 'active' || c.next_due_date !== settledDueDate) return;
    const next = nextOccurrence(c.next_due_date, c.frequency, c.interval_count, c.anchor_day);
    if (!next) {
      await trx.updateTable('financial_commitments').set({ status: 'completed', updated_at: new Date() }).where('id', '=', c.id).execute();
      return;
    }
    await trx.updateTable('financial_commitments').set({ next_due_date: next, updated_at: new Date() }).where('id', '=', c.id).execute();
    // Allocate first: the next occurrence is reserved in full straight away.
    await this.insertReservation(trx, user, { commitmentId: c.id, accountId: c.account_id, name: c.name, target: c.amount, reserved: c.amount, dueDate: next });
  }

  private async insertReservation(
    trx: Executor,
    user: AuthUser,
    r: { commitmentId: string | null; accountId: string; name: string; target: string; reserved: string; dueDate: string },
  ): Promise<ReservationRow> {
    const row = await trx
      .insertInto('money_reservations')
      .values({
        owner_id: user.userId,
        organization_id: user.organizationId,
        commitment_id: r.commitmentId,
        account_id: r.accountId,
        name: r.name,
        target_amount: r.target,
        reserved_amount: r.reserved,
        due_date: r.dueDate,
        transaction_id: null,
        settled_amount: null,
        variance: null,
        closed_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'money_reservation', entityId: row.id, action: 'created', after: row });
    return row;
  }

  private async findActive(trx: Executor, ownerId: string, id: string): Promise<ReservationRow> {
    const r = await trx.selectFrom('money_reservations').selectAll().where('id', '=', id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
    if (!r) throw notFound('Reservation');
    if (r.status !== 'active') throw new DomainError('reservation_not_active', 'This reservation is already closed.', HttpStatus.CONFLICT);
    return r;
  }

  private async position(trx: Executor, ownerId: string) {
    const p = await this.summary.spendable(ownerId, trx);
    return {
      liquidBalance: fmt(p.liquidBalance),
      reserved: fmt(p.reserved),
      availableToSpend: fmt(p.available),
      overcommitted: p.available.isNegative(),
    };
  }

  private presentCommitment(c: Selectable<import('../database/schema').FinancialCommitmentsTable>) {
    return {
      id: c.id,
      name: c.name,
      amount: c.amount,
      currency: c.currency,
      accountId: c.account_id,
      categoryId: c.category_id,
      frequency: c.frequency,
      intervalCount: c.interval_count,
      nextDueDate: c.next_due_date,
      reminderDaysBefore: c.reminder_days_before,
      status: c.status,
    };
  }
}
