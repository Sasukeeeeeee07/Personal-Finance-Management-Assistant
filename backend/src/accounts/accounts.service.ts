import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';
import Decimal from 'decimal.js';
import { AuthUser } from '../common/auth-context';
import { DomainError, notFound } from '../common/errors';
import { fmt, money } from '../common/money';
import { DATABASE } from '../database/database.module';
import type { AccountType, BankAccountsTable, DB, Executor } from '../database/schema';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../transactions/ledger.service';
import { CreateAccountDto, ReconcileAccountDto, UpdateAccountDto } from './dto/account.dto';

const LIQUID_BY_DEFAULT: AccountType[] = ['savings', 'current', 'cash', 'upi_bank', 'wallet'];

type AccountRow = Selectable<BankAccountsTable>;

export function presentAccount(a: AccountRow, balance: Decimal) {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    institutionName: a.institution_name,
    accountMask: a.account_mask,
    currency: a.currency,
    isLiquid: a.is_liquid,
    isLiability: a.is_liability,
    creditLimit: a.credit_limit,
    openingDate: a.opening_date,
    archived: !!a.archived_at,
    /** Signed ledger balance. Negative on a credit card means money owed. */
    balance: fmt(balance),
    /** For liability accounts: the amount owed (positive). */
    outstanding: a.is_liability ? fmt(Decimal.max(balance.neg(), 0)) : null,
    availableCredit: a.is_liability && a.credit_limit ? fmt(money(a.credit_limit).plus(balance)) : null,
  };
}

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DATABASE) private readonly db: DB,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, includeArchived = false) {
    let q = this.db.selectFrom('bank_accounts').selectAll().where('owner_id', '=', user.userId).where('deleted_at', 'is', null);
    if (!includeArchived) q = q.where('archived_at', 'is', null);
    const accounts = await q.orderBy('created_at').execute();
    const balances = await this.ledger.balances(this.db, user.userId);
    return accounts.map((a) => presentAccount(a, balances.get(a.id) ?? new Decimal(0)));
  }

  async get(user: AuthUser, id: string) {
    const a = await this.findOwned(this.db, user.userId, id);
    const balances = await this.ledger.balances(this.db, user.userId, [id]);
    return presentAccount(a, balances.get(id) ?? new Decimal(0));
  }

  async create(user: AuthUser, dto: CreateAccountDto) {
    const isLiability = dto.type === 'credit_card';
    if (isLiability && dto.isLiquid) throw new DomainError('invalid_account', 'A credit card cannot be counted as spendable money.');
    const opening = money(dto.openingBalance ?? '0');
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('bank_accounts')
        .values({
          owner_id: user.userId,
          organization_id: user.organizationId,
          name: dto.name.trim(),
          type: dto.type,
          institution_name: dto.institutionName?.trim() || null,
          account_mask: dto.accountMask ?? null,
          currency: dto.currency ?? 'INR',
          // Liabilities are stored as negative balances: owing ₹5,000 is −5000.
          opening_balance: fmt(isLiability ? opening.neg() : opening),
          opening_date: dto.openingDate,
          is_liquid: dto.isLiquid ?? LIQUID_BY_DEFAULT.includes(dto.type),
          is_liability: isLiability,
          credit_limit: dto.creditLimit ?? null,
          archived_at: null,
          deleted_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'bank_account', entityId: row.id, action: 'created', after: row });
      return presentAccount(row, money(row.opening_balance));
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateAccountDto) {
    return this.db.transaction().execute(async (trx) => {
      const before = await this.findOwned(trx, user.userId, id, true);
      if (before.is_liability && dto.isLiquid) throw new DomainError('invalid_account', 'A credit card cannot be counted as spendable money.');
      const after = await trx
        .updateTable('bank_accounts')
        .set({
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.institutionName !== undefined && { institution_name: dto.institutionName.trim() || null }),
          ...(dto.accountMask !== undefined && { account_mask: dto.accountMask }),
          ...(dto.isLiquid !== undefined && { is_liquid: dto.isLiquid }),
          ...(dto.creditLimit !== undefined && { credit_limit: dto.creditLimit }),
          ...(dto.archived !== undefined && { archived_at: dto.archived ? new Date() : null }),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'bank_account', entityId: id, action: 'updated', before, after });
      const balances = await this.ledger.balances(trx, user.userId, [id]);
      return presentAccount(after, balances.get(id)!);
    });
  }

  /** Accounts with history can only be archived, so past reports stay correct. */
  async remove(user: AuthUser, id: string) {
    await this.db.transaction().execute(async (trx) => {
      await this.findOwned(trx, user.userId, id, true);
      const used = await trx
        .selectFrom('transactions')
        .select('id')
        .where('deleted_at', 'is', null)
        .where((eb) => eb.or([eb('account_id', '=', id), eb('destination_account_id', '=', id)]))
        .limit(1)
        .executeTakeFirst();
      if (used) throw new DomainError('account_has_transactions', 'This account has transactions. Archive it instead so your history stays intact.', HttpStatus.CONFLICT);
      await trx.updateTable('bank_accounts').set({ deleted_at: new Date() }).where('id', '=', id).execute();
      await this.audit.record(trx, { organizationId: user.organizationId, actorId: user.userId, entityType: 'bank_account', entityId: id, action: 'deleted' });
    });
  }

  /** Compare the tracked balance with what the bank shows and report the gap. */
  async reconcile(user: AuthUser, id: string, dto: ReconcileAccountDto) {
    const account = await this.findOwned(this.db, user.userId, id);
    const tracked = (await this.ledger.balances(this.db, user.userId, [id])).get(id)!;
    const actual = account.is_liability ? money(dto.actualBalance).neg() : money(dto.actualBalance);
    const difference = actual.minus(tracked);
    return {
      accountId: id,
      trackedBalance: fmt(tracked),
      actualBalance: fmt(actual),
      difference: fmt(difference),
      matches: difference.isZero(),
      hint: difference.isZero()
        ? 'Your tracked balance matches.'
        : difference.isNegative()
          ? `Your bank shows ${fmt(difference.abs())} less than tracked. You may have expenses that aren't recorded yet.`
          : `Your bank shows ${fmt(difference)} more than tracked. You may have income that isn't recorded yet.`,
    };
  }

  /** Throws 404 for accounts owned by anyone else — never reveals that they exist. */
  async findOwned(db: Executor, ownerId: string, id: string, lock = false): Promise<AccountRow> {
    let q = db.selectFrom('bank_accounts').selectAll().where('id', '=', id).where('owner_id', '=', ownerId).where('deleted_at', 'is', null);
    if (lock) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    if (!row) throw notFound('Account');
    return row;
  }
}
