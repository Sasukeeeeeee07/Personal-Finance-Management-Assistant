import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import Decimal from 'decimal.js';
import type { Executor, TransactionsTable } from '../database/schema';
import { money } from '../common/money';
import type { Selectable } from 'kysely';

type Txn = Pick<Selectable<TransactionsTable>, 'id' | 'owner_id' | 'type' | 'status' | 'amount' | 'account_id' | 'destination_account_id' | 'deleted_at'> & { is_historical?: boolean };

/**
 * The append-only ledger. A transaction contributes entries only while it is confirmed and not deleted.
 *   income   : +amount on account
 *   expense  : −amount on account (on a credit card this increases the amount owed)
 *   transfer : −amount on source, +amount on destination (never income or expense)
 * Edits and deletions never mutate entries; they post reversing entries so history stays auditable.
 */
@Injectable()
export class LedgerService {
  static entriesFor(t: Txn): { account_id: string; amount: Decimal }[] {
    // Historical imports predate the opening balance, which already includes them.
    if (t.status !== 'confirmed' || t.deleted_at || t.is_historical) return [];
    const amt = money(t.amount);
    switch (t.type) {
      case 'income':
        return [{ account_id: t.account_id, amount: amt }];
      case 'expense':
        return [{ account_id: t.account_id, amount: amt.neg() }];
      case 'transfer':
        return [
          { account_id: t.account_id, amount: amt.neg() },
          { account_id: t.destination_account_id!, amount: amt },
        ];
    }
  }

  /** Post the difference between the transaction's previous and new effect. Call inside a DB transaction. */
  async post(db: Executor, before: Txn | null, after: Txn): Promise<void> {
    const oldEntries = before ? LedgerService.entriesFor(before) : [];
    const newEntries = LedgerService.entriesFor(after);
    const key = (es: { account_id: string; amount: Decimal }[]) => es.map((e) => `${e.account_id}:${e.amount.toFixed(2)}`).join('|');
    if (key(oldEntries) === key(newEntries)) return; // e.g. only the description changed

    // Reverse the old effect and write the new one explicitly so the trail shows both legs.
    const row = (accountId: string, amount: Decimal) => ({ owner_id: after.owner_id, transaction_id: after.id, account_id: accountId, amount: amount.toFixed(2) });
    const rows = [...oldEntries.map((e) => row(e.account_id, e.amount.neg())), ...newEntries.map((e) => row(e.account_id, e.amount))];
    await db.insertInto('ledger_entries').values(rows).execute();
  }

  /** Current balance per account: opening_balance + Σ ledger entries. */
  async balances(db: Executor, ownerId: string, accountIds?: string[]): Promise<Map<string, Decimal>> {
    let q = db
      .selectFrom('bank_accounts as a')
      .leftJoin('ledger_entries as l', 'l.account_id', 'a.id')
      .select(['a.id', sql<string>`a.opening_balance + COALESCE(SUM(l.amount), 0)`.as('balance')])
      .where('a.owner_id', '=', ownerId)
      .where('a.deleted_at', 'is', null)
      .groupBy(['a.id', 'a.opening_balance']);
    if (accountIds?.length) q = q.where('a.id', 'in', accountIds);
    const rows = await q.execute();
    return new Map(rows.map((r) => [r.id, money(r.balance)]));
  }
}
