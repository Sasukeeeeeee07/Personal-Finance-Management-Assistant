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
    closeReason: r.close_reason,
    occurrenceDate: r.occurrence_date,
    createdFromReservationId: r.created_from_reservation_id,
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
        .set({ status: 'cancelled', close_reason: 'commitment_cancelled', closed_at: new Date(), updated_at: new Date() })
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
      const after = await trx
        .updateTable('money_reservations')
        .set({ status: 'released', close_reason: 'released_by_user', closed_at: new Date(), updated_at: new Date() })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'money_reservation', entityId: id, action: 'released', before: r, after });
      if (r.commitment_id) await this.scheduleSuccessor(trx, user, after);
      return { reservation: presentReservation(after), position: await this.position(trx, user.userId) };
    });
  }

  async settleWithExisting(user: AuthUser, id: string, dto: SettleReservationDto) {
    return this.db.transaction().execute(async (trx) => {
      // Lock order everywhere: transaction → reservation → commitment.
      const txn = await trx.selectFrom('transactions').selectAll().where('id', '=', dto.transactionId).where('owner_id', '=', user.userId).where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
      if (!txn) throw notFound('Transaction');
      const reservation = await this.settle(trx, user, id, txn, dto.acceptDifference ?? false);
      return { reservation, position: await this.position(trx, user.userId) };
    });
  }

  /**
   * Reconcile a reservation against the payment that settled it. Must run in the same DB transaction
   * as the payment: the expense lowers the balance while the reservation stops counting as reserved,
   * so available-to-spend drops exactly once. Records a settlement row (the auditable link) and, for
   * recurring commitments, reserves the next occurrence as this reservation's successor.
   */
  async settle(trx: Executor, user: AuthUser, reservationId: string, txn: TxnRow, acceptDifference: boolean) {
    const r = await this.findActive(trx, user.userId, reservationId);
    if (txn.status !== 'confirmed' || (txn.type !== 'expense' && txn.type !== 'transfer')) {
      throw new DomainError('invalid_settlement', 'Only a confirmed expense or bill payment can settle a reservation.');
    }
    const linked = await trx.selectFrom('reservation_settlements').select('id').where('transaction_id', '=', txn.id).where('status', '=', 'active').executeTakeFirst();
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
    await trx.insertInto('reservation_settlements').values({ owner_id: user.userId, reservation_id: r.id, transaction_id: txn.id, amount: fmt(paid), variance: fmt(variance), reversal_reason: null, reversed_at: null }).execute();
    const after = await trx
      .updateTable('money_reservations')
      .set({ status: 'reconciled', transaction_id: txn.id, settled_amount: fmt(paid), variance: fmt(variance), close_reason: 'paid', closed_at: new Date(), updated_at: new Date() })
      .where('id', '=', r.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'money_reservation', entityId: r.id, action: 'reconciled', before: r, after });
    if (r.commitment_id) await this.scheduleSuccessor(trx, user, after);
    return presentReservation(after);
  }

  /**
   * The payment that settled a reservation was deleted, unconfirmed or changed type. Restores the
   * exact pre-payment state in the caller's DB transaction:
   *  1. the settlement link is marked reversed (kept for audit);
   *  2. the occurrence it paid is held again;
   *  3. the successor occurrence this payment spawned is cancelled if it is still open, and the
   *     commitment points back at the reopened occurrence — so one obligation is never reserved twice.
   * A successor that was itself already paid is left alone: it is a separate, settled occurrence.
   */
  async reverseSettlementFor(trx: Executor, user: AuthUser, transactionId: string, reason: string) {
    const s = await trx.selectFrom('reservation_settlements').selectAll().where('transaction_id', '=', transactionId).where('owner_id', '=', user.userId).where('status', '=', 'active').forUpdate().executeTakeFirst();
    if (!s) return;
    await trx.updateTable('reservation_settlements').set({ status: 'reversed', reversal_reason: reason, reversed_at: new Date() }).where('id', '=', s.id).execute();

    const before = await trx.selectFrom('money_reservations').selectAll().where('id', '=', s.reservation_id).forUpdate().executeTakeFirstOrThrow();
    const reopened = await trx
      .updateTable('money_reservations')
      .set({ status: 'active', transaction_id: null, settled_amount: null, variance: null, close_reason: null, closed_at: null, updated_at: new Date() })
      .where('id', '=', before.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'money_reservation', entityId: before.id, action: 'reopened', before, after: { ...reopened, reason } });

    if (!before.commitment_id) return;
    // Lock order everywhere: transaction → reservation(s) → commitment. The successor reservation must be
    // locked before the commitment; settling the successor concurrently takes successor → commitment, and
    // the reverse order here deadlocked under real network latency (seen on Neon).
    const successor = await trx
      .selectFrom('money_reservations')
      .selectAll()
      .where('created_from_reservation_id', '=', before.id)
      .where('status', '!=', 'cancelled')
      .forUpdate()
      .executeTakeFirst();
    const c = await trx.selectFrom('financial_commitments').selectAll().where('id', '=', before.commitment_id).forUpdate().executeTakeFirstOrThrow();
    if (successor && successor.status === 'active') {
      const cancelled = await trx
        .updateTable('money_reservations')
        .set({ status: 'cancelled', close_reason: 'superseded_by_payment_reversal', closed_at: new Date(), updated_at: new Date() })
        .where('id', '=', successor.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'money_reservation', entityId: successor.id, action: 'cancelled', before: successor, after: cancelled });
    }
    // Point the commitment back at the reopened occurrence when nothing later has been paid.
    if (!successor || successor.status === 'active') {
      if (c.status !== 'cancelled') {
        await trx.updateTable('financial_commitments').set({ status: 'active', next_due_date: before.occurrence_date, updated_at: new Date() }).where('id', '=', c.id).execute();
      }
    }
  }

  /** Keep the settlement in sync when the settling payment's amount is corrected. */
  async syncSettledAmount(trx: Executor, transactionId: string, amount: string) {
    const s = await trx.selectFrom('reservation_settlements').select(['id', 'reservation_id']).where('transaction_id', '=', transactionId).where('status', '=', 'active').executeTakeFirst();
    if (!s) return;
    const r = await trx.selectFrom('money_reservations').select('target_amount').where('id', '=', s.reservation_id).executeTakeFirstOrThrow();
    const variance = fmt(money(amount).minus(r.target_amount));
    await trx.updateTable('reservation_settlements').set({ amount: fmt(amount), variance }).where('id', '=', s.id).execute();
    await trx.updateTable('money_reservations').set({ settled_amount: fmt(amount), variance, updated_at: new Date() }).where('id', '=', s.reservation_id).execute();
  }

  async settlementHistory(user: AuthUser, reservationId: string) {
    const owned = await this.db.selectFrom('money_reservations').select('id').where('id', '=', reservationId).where('owner_id', '=', user.userId).executeTakeFirst();
    if (!owned) throw notFound('Reservation');
    const rows = await this.db.selectFrom('reservation_settlements').selectAll().where('reservation_id', '=', reservationId).orderBy('created_at').execute();
    return rows.map((x) => ({ id: x.id, transactionId: x.transaction_id, amount: x.amount, variance: x.variance, status: x.status, reversalReason: x.reversal_reason, createdAt: x.created_at, reversedAt: x.reversed_at }));
  }

  // --- internals -----------------------------------------------------------------------------

  /**
   * After an occurrence closes (paid or released), reserve the next occurrence that does not exist
   * yet, linked as this occurrence's successor. Does nothing if the commitment already points past
   * this occurrence (a later occurrence was scheduled independently, e.g. after a reversal).
   */
  private async scheduleSuccessor(trx: Executor, user: AuthUser, closed: ReservationRow) {
    const c = await trx.selectFrom('financial_commitments').selectAll().where('id', '=', closed.commitment_id!).forUpdate().executeTakeFirstOrThrow();
    if (c.status !== 'active' || c.next_due_date > closed.occurrence_date) return;
    let next = nextOccurrence(closed.occurrence_date, c.frequency, c.interval_count, c.anchor_day);
    // Skip occurrences that already exist (e.g. paid before an earlier payment was reversed).
    while (next) {
      const exists = await trx.selectFrom('money_reservations').select('id').where('commitment_id', '=', c.id).where('occurrence_date', '=', next).where('status', '!=', 'cancelled').executeTakeFirst();
      if (!exists) break;
      next = nextOccurrence(next, c.frequency, c.interval_count, c.anchor_day);
    }
    if (!next) {
      await trx.updateTable('financial_commitments').set({ status: 'completed', updated_at: new Date() }).where('id', '=', c.id).execute();
      return;
    }
    await trx.updateTable('financial_commitments').set({ next_due_date: next, updated_at: new Date() }).where('id', '=', c.id).execute();
    // Allocate first: the next occurrence is reserved in full straight away.
    await this.insertReservation(trx, user, { commitmentId: c.id, accountId: c.account_id, name: c.name, target: c.amount, reserved: c.amount, dueDate: next, createdFrom: closed.id });
  }

  private async insertReservation(
    trx: Executor,
    user: AuthUser,
    r: { commitmentId: string | null; accountId: string; name: string; target: string; reserved: string; dueDate: string; createdFrom?: string },
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
        occurrence_date: r.dueDate,
        created_from_reservation_id: r.createdFrom ?? null,
        close_reason: null,
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
