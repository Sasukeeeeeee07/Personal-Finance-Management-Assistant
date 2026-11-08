import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql, type Insertable, type Selectable } from 'kysely';
import { AuthUser } from '../common/auth-context';
import { DomainError, notFound } from '../common/errors';
import { fmt, money } from '../common/money';
import { DATABASE } from '../database/database.module';
import type { DB, Executor, TransactionsTable } from '../database/schema';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { CategoriesService } from '../categories/categories';
import { ReservationsService } from '../reservations/reservations.service';
import { BudgetsService } from '../budgets/budgets.service';
import { IdempotencyService } from '../common/idempotency.service';
import { today } from '../common/dates';
import { LedgerService } from './ledger.service';
import { CreateTransactionDto, ListTransactionsQuery, UpdateTransactionDto } from './dto/transaction.dto';

type TxnRow = Selectable<TransactionsTable>;
const FUZZY_WINDOW_MS = 10 * 60 * 1000;

export function presentTransaction(t: TxnRow) {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    amount: t.amount,
    currency: t.currency,
    accountId: t.account_id,
    destinationAccountId: t.destination_account_id,
    categoryId: t.category_id,
    occurredAt: t.occurred_at,
    merchant: t.merchant,
    sourceName: t.source_name,
    description: t.description,
    notes: t.notes,
    paymentMethod: t.payment_method,
    externalReference: t.external_reference,
    source: t.source,
    isPlanned: t.is_planned,
    isEssential: t.is_essential,
    isRecurring: t.is_recurring,
    duplicateOfId: t.duplicate_of_id,
    isHistorical: t.is_historical,
    version: t.version,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(DATABASE) private readonly db: DB,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
    private readonly reservations: ReservationsService,
    private readonly audit: AuditService,
    private readonly budgets: BudgetsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Records the transaction, then reports any budget thresholds it pushed past. */
  async create(user: AuthUser, dto: CreateTransactionDto, idempotencyKey?: string) {
    const { replayed, body } = await this.createOnce(user, dto, idempotencyKey);
    // A replay returns the original result; its alerts were already raised the first time.
    return { ...body, budgetAlerts: replayed ? [] : await this.budgets.evaluateAlertsSafely(user.userId), idempotentReplay: replayed };
  }

  private async createOnce(user: AuthUser, dto: CreateTransactionDto, key?: string) {
    const attempt = () => this.db.transaction().execute((trx) => this.idempotency.run(trx, user.userId, key, 'POST /transactions', dto, () => this.createIn(trx, user, dto)));
    try {
      return await attempt();
    } catch (e: any) {
      // Two copies of the same bank reference raced each other; the loser is stored as a duplicate.
      if (e?.code === '23505' && String(e?.constraint ?? e?.message).includes('transactions_external_ref_unique')) return attempt();
      throw e;
    }
  }

  private async createIn(trx: Executor, user: AuthUser, dto: CreateTransactionDto) {
    const draft: Insertable<TransactionsTable> = {
      owner_id: user.userId,
      organization_id: user.organizationId,
      type: dto.type,
      status: dto.status ?? 'confirmed',
      amount: fmt(dto.amount),
      account_id: dto.accountId,
      destination_account_id: dto.type === 'transfer' ? dto.destinationAccountId! : null,
      category_id: dto.type === 'transfer' ? null : dto.categoryId ?? null,
      occurred_at: dto.occurredAt,
      merchant: dto.merchant?.trim() || null,
      source_name: dto.sourceName?.trim() || null,
      description: dto.description?.trim() || null,
      notes: dto.notes?.trim() || null,
      payment_method: dto.paymentMethod ?? null,
      external_reference: dto.externalReference?.trim() || null,
      source: dto.source ?? 'manual',
      is_planned: dto.isPlanned ?? (dto.reservationId ? true : null),
      is_essential: dto.isEssential ?? null,
      is_recurring: dto.isRecurring ?? false,
      is_historical: dto.historical ?? false,
      duplicate_of_id: null,
      deleted_at: null,
    };
    if (dto.historical && dto.reservationId) throw new DomainError('historical_settlement', 'A historical import cannot pay a current reservation.');
    if (dto.type === 'transfer' && dto.categoryId) throw new DomainError('transfer_category', 'Transfers between your own accounts do not have a category.');
    const currency = await this.validate(trx, user, draft);
    draft.currency = currency;
    if (draft.is_essential === null && draft.category_id) {
      const c = await trx.selectFrom('transaction_categories').select('is_essential').where('id', '=', draft.category_id).executeTakeFirstOrThrow();
      draft.is_essential = c.is_essential;
    }

    const dup = await this.findDuplicate(trx, user.userId, draft);
    if (dup) {
      draft.status = dup.exact ? 'duplicate' : 'needs_review';
      draft.duplicate_of_id = dup.id;
    }

    const row = await trx.insertInto('transactions').values(draft).returningAll().executeTakeFirstOrThrow();
    await this.ledger.post(trx, null, row);
    await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'transaction', entityId: row.id, action: 'created', after: row });

    let reservation = null;
    if (dto.reservationId) {
      if (row.status !== 'confirmed') {
        throw new DomainError('invalid_settlement', 'This transaction looks like a duplicate, so it was not used to pay the reservation. Review it first.', HttpStatus.CONFLICT);
      }
      reservation = await this.reservations.settle(trx, user, dto.reservationId, row, dto.acceptReservationDifference ?? false);
    }
    return { transaction: presentTransaction(row), reservation, duplicateOf: dup ? { id: dup.id, exact: dup.exact } : null };
  }

  async update(user: AuthUser, id: string, dto: UpdateTransactionDto) {
    const updated = await this.db.transaction().execute(async (trx) => {
      const before = await this.findOwned(trx, user.userId, id, true);
      if (before.version !== dto.version) {
        throw new DomainError('stale_version', 'This transaction was changed somewhere else. Reload it and try again.', HttpStatus.CONFLICT);
      }
      const type = dto.type ?? before.type;
      const patch: Partial<TxnRow> = {
        type,
        amount: dto.amount !== undefined ? fmt(dto.amount) : before.amount,
        account_id: dto.accountId ?? before.account_id,
        destination_account_id: type === 'transfer' ? (dto.destinationAccountId !== undefined ? dto.destinationAccountId : before.destination_account_id) : null,
        category_id: type === 'transfer' ? null : dto.categoryId !== undefined ? dto.categoryId : before.category_id,
        occurred_at: dto.occurredAt ? new Date(dto.occurredAt) : before.occurred_at,
        merchant: dto.merchant !== undefined ? dto.merchant.trim() || null : before.merchant,
        source_name: dto.sourceName !== undefined ? dto.sourceName.trim() || null : before.source_name,
        description: dto.description !== undefined ? dto.description.trim() || null : before.description,
        notes: dto.notes !== undefined ? dto.notes.trim() || null : before.notes,
        payment_method: dto.paymentMethod ?? before.payment_method,
        status: dto.status ?? before.status,
        is_planned: dto.isPlanned ?? before.is_planned,
        is_essential: dto.isEssential ?? before.is_essential,
        is_recurring: dto.isRecurring ?? before.is_recurring,
        duplicate_of_id: dto.status && dto.status !== 'duplicate' ? null : before.duplicate_of_id,
      };
      if (type === 'transfer' && !patch.destination_account_id) throw new DomainError('missing_destination', 'Choose the account the money goes to.');
      const currency = await this.validate(trx, user, { ...before, ...patch } as Insertable<TransactionsTable>);

      const after = await trx
        .updateTable('transactions')
        .set({ ...patch, currency, version: before.version + 1, updated_at: new Date() })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.ledger.post(trx, before, after);
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'transaction', entityId: id, action: 'updated', before, after });

      if (after.status !== 'confirmed' || (after.type !== 'expense' && after.type !== 'transfer')) {
        await this.reservations.reverseSettlementFor(trx, user, id, after.status !== 'confirmed' ? `payment_status_${after.status}` : 'payment_type_changed');
      } else if (after.amount !== before.amount) {
        await this.reservations.syncSettledAmount(trx, id, after.amount);
      }
      return presentTransaction(after);
    });
    await this.budgets.evaluateAlertsSafely(user.userId);
    return updated;
  }

  async remove(user: AuthUser, id: string) {
    await this.db.transaction().execute(async (trx) => {
      const before = await this.findOwned(trx, user.userId, id, true);
      const after = await trx.updateTable('transactions').set({ deleted_at: new Date(), updated_at: new Date(), version: before.version + 1 }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.ledger.post(trx, before, after);
      await this.reservations.reverseSettlementFor(trx, user, id, 'payment_deleted');
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'transaction', entityId: id, action: 'deleted', before });
    });
  }

  async get(user: AuthUser, id: string) {
    const t = await this.findOwned(this.db, user.userId, id);
    return { ...presentTransaction(t), insight: await this.insightFor(user.userId, t) };
  }

  async list(user: AuthUser, q: ListTransactionsQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    let query = this.db.selectFrom('transactions').where('owner_id', '=', user.userId).where('deleted_at', 'is', null);
    if (q.from) query = query.where('occurred_at', '>=', new Date(q.from));
    if (q.to) query = query.where('occurred_at', '<', new Date(q.to));
    if (q.type) query = query.where('type', '=', q.type);
    if (q.status) query = query.where('status', '=', q.status);
    if (q.categoryId) query = query.where('category_id', '=', q.categoryId);
    if (q.accountId) query = query.where((eb) => eb.or([eb('account_id', '=', q.accountId!), eb('destination_account_id', '=', q.accountId!)]));
    if (q.search) {
      const term = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      query = query.where((eb) => eb.or([eb('merchant', 'ilike', term), eb('description', 'ilike', term), eb('source_name', 'ilike', term)]));
    }
    const [{ total }] = await query.select(sql<string>`COUNT(*)`.as('total')).execute();
    const [field, dir] = (q.sort ?? 'occurredAt:desc').split(':') as ['occurredAt' | 'amount', 'asc' | 'desc'];
    // id is the final tie-breaker so pages never overlap or skip rows.
    const rows = await query
      .selectAll()
      .orderBy(field === 'amount' ? 'amount' : 'occurred_at', dir)
      .orderBy('created_at', dir)
      .orderBy('id', dir)
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();
    return { items: rows.map(presentTransaction), page, pageSize, total: Number(total), sort: `${field}:${dir}` };
  }

  async history(user: AuthUser, id: string) {
    await this.findOwned(this.db, user.userId, id, false, true);
    const rows = await this.db
      .selectFrom('audit_logs')
      .select(['id', 'action', 'before', 'after', 'created_at'])
      .where('entity_type', '=', 'transaction')
      .where('entity_id', '=', id)
      .where('actor_id', '=', user.userId)
      .orderBy('id')
      .execute();
    return rows.map((r) => ({ id: r.id, action: r.action, before: r.before, after: r.after, at: r.created_at }));
  }

  // --- internals -----------------------------------------------------------------------------

  /** Validates ownership, account state, category kind and currency. Returns the transaction currency. */
  private async validate(trx: Executor, user: AuthUser, t: Insertable<TransactionsTable>): Promise<string> {
    const account = await this.accounts.findOwned(trx, user.userId, t.account_id);
    if (account.archived_at) throw new DomainError('account_archived', `${account.name} is archived. Unarchive it to add transactions.`);
    const involved = [account];
    if (t.type === 'transfer') {
      if (t.destination_account_id === t.account_id) throw new DomainError('same_account_transfer', 'Choose two different accounts for a transfer.');
      const dest = await this.accounts.findOwned(trx, user.userId, t.destination_account_id!);
      if (dest.archived_at) throw new DomainError('account_archived', `${dest.name} is archived. Unarchive it to add transactions.`);
      if (dest.currency !== account.currency) throw new DomainError('currency_mismatch', 'Transfers between accounts in different currencies are not supported yet.');
      involved.push(dest);
    }
    this.assertTrackingWindow(t, involved);
    if (t.category_id && t.type !== 'transfer') await this.categories.assertUsable(trx, user.userId, t.category_id, t.type);
    return account.currency;
  }

  /**
   * An account's opening balance applies from its tracking start date (India time).
   * Live transactions must fall on or after it; explicit historical imports must fall before it
   * and never reach the ledger, so the opening balance is not double-counted.
   */
  private assertTrackingWindow(t: Insertable<TransactionsTable>, accounts: { name: string; tracking_start_date: string }[]) {
    const day = today('Asia/Kolkata', new Date(t.occurred_at as string | Date));
    const early = accounts.filter((a) => day < a.tracking_start_date);
    if (t.is_historical) {
      if (t.source !== 'statement_import' && t.source !== 'account_aggregator') {
        throw new DomainError('historical_source', 'Only statement imports can add historical transactions.');
      }
      if (early.length !== accounts.length) {
        throw new DomainError('not_historical', 'This transaction is on or after the date you started tracking the account. Add it as a normal transaction.');
      }
      return;
    }
    if (early.length) {
      const a = early[0];
      throw new DomainError(
        'before_tracking_start',
        `This date is before you started tracking ${a.name} (${a.tracking_start_date}). Your opening balance already includes it. Import older statements as historical transactions instead.`,
      );
    }
  }

  /**
   * Exact: same account and bank reference → duplicate (never counted).
   * Fuzzy: an automatically captured transaction with the same account, type and amount within ±10 minutes
   * of another one → needs_review, so the user decides.
   */
  private async findDuplicate(trx: Executor, ownerId: string, t: Insertable<TransactionsTable>): Promise<{ id: string; exact: boolean } | null> {
    if (t.status !== 'confirmed' && t.status !== 'needs_review') return null;
    if (t.external_reference) {
      const exact = await trx
        .selectFrom('transactions')
        .select('id')
        .where('owner_id', '=', ownerId)
        .where('account_id', '=', t.account_id)
        .where('external_reference', '=', t.external_reference)
        .where('status', 'in', ['confirmed', 'needs_review'])
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (exact) return { id: exact.id, exact: true };
    }
    if (t.source === 'manual') return null;
    const at = new Date(t.occurred_at as string).getTime();
    const near = await trx
      .selectFrom('transactions')
      .select(['id', 'external_reference'])
      .where('owner_id', '=', ownerId)
      .where('account_id', '=', t.account_id)
      .where('type', '=', t.type)
      .where('amount', '=', t.amount!)
      .where('status', 'in', ['confirmed', 'needs_review'])
      .where('deleted_at', 'is', null)
      .where('occurred_at', '>=', new Date(at - FUZZY_WINDOW_MS))
      .where('occurred_at', '<=', new Date(at + FUZZY_WINDOW_MS))
      .executeTakeFirst();
    // Two different bank references are two different transactions.
    if (near && !(near.external_reference && t.external_reference && near.external_reference !== t.external_reference)) {
      return { id: near.id, exact: false };
    }
    return null;
  }

  /** Expense intelligence: how this expense sits in its category this month vs last month. */
  private async insightFor(ownerId: string, t: TxnRow) {
    if (t.type !== 'expense' || !t.category_id) return null;
    const rows = await sql<{ this_month: string; last_month: string }>`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE date_trunc('month', occurred_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', ${t.occurred_at}::timestamptz AT TIME ZONE 'Asia/Kolkata')), 0) AS this_month,
        COALESCE(SUM(amount) FILTER (WHERE date_trunc('month', occurred_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', ${t.occurred_at}::timestamptz AT TIME ZONE 'Asia/Kolkata') - interval '1 month'), 0) AS last_month
      FROM transactions
      WHERE owner_id = ${ownerId} AND category_id = ${t.category_id} AND type = 'expense'
        AND status = 'confirmed' AND deleted_at IS NULL
    `.execute(this.db);
    const { this_month, last_month } = rows.rows[0];
    const change = money(this_month).minus(last_month);
    return {
      categoryId: t.category_id,
      categorySpentThisMonth: fmt(this_month),
      categorySpentLastMonth: fmt(last_month),
      changeFromLastMonth: fmt(change),
      // The category budget this expense counts against, in the period the expense falls in.
      budget: await this.budgets.impactFor(ownerId, t.category_id, today('Asia/Kolkata', new Date(t.occurred_at))),
    };
  }

  private async findOwned(db: Executor, ownerId: string, id: string, lock = false, includeDeleted = false): Promise<TxnRow> {
    let q = db.selectFrom('transactions').selectAll().where('id', '=', id).where('owner_id', '=', ownerId);
    if (!includeDeleted) q = q.where('deleted_at', 'is', null);
    if (lock) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    if (!row) throw notFound('Transaction');
    return row;
  }
}
