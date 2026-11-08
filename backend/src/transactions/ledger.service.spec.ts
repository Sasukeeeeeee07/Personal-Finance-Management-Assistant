import { LedgerService } from './ledger.service';

const base = { id: 't', owner_id: 'o', amount: '100.50', account_id: 'A', destination_account_id: null, deleted_at: null } as const;
const entries = (t: any) => LedgerService.entriesFor(t).map((e) => [e.account_id, e.amount.toFixed(2)]);

describe('LedgerService.entriesFor', () => {
  it('income credits, expense debits', () => {
    expect(entries({ ...base, type: 'income', status: 'confirmed' })).toEqual([['A', '100.50']]);
    expect(entries({ ...base, type: 'expense', status: 'confirmed' })).toEqual([['A', '-100.50']]);
  });

  it('transfer moves money and nets to zero', () => {
    expect(entries({ ...base, type: 'transfer', status: 'confirmed', destination_account_id: 'B' })).toEqual([
      ['A', '-100.50'],
      ['B', '100.50'],
    ]);
  });

  it('non-confirmed or deleted transactions have no effect', () => {
    for (const status of ['needs_review', 'duplicate', 'ignored', 'failed']) {
      expect(entries({ ...base, type: 'expense', status })).toEqual([]);
    }
    expect(entries({ ...base, type: 'expense', status: 'confirmed', deleted_at: new Date() })).toEqual([]);
  });

  it('uses exact decimal arithmetic', () => {
    expect(entries({ ...base, amount: '0.10', type: 'income', status: 'confirmed' })).toEqual([['A', '0.10']]);
  });
});
