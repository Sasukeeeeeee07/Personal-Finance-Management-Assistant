import { category, createTestApp, now, registerUser, TestApp, TestUser } from './helpers';

/** Critical financial test cases from the product requirements (section 21). */
describe('Core financial rules', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  async function setup() {
    const u = await registerUser(t);
    const bank = (await u.post('/accounts', { name: 'HDFC Savings', type: 'savings', openingBalance: '30000' }).expect(201)).body;
    const wallet = (await u.post('/accounts', { name: 'Paytm', type: 'wallet', openingBalance: '0' }).expect(201)).body;
    const card = (await u.post('/accounts', { name: 'ICICI Card', type: 'credit_card', openingBalance: '0', creditLimit: '50000' }).expect(201)).body;
    return { u, bank, wallet, card };
  }
  const balance = async (u: TestUser, id: string) => (await u.get(`/accounts/${id}`).expect(200)).body.balance;
  const summary = async (u: TestUser) => (await u.get('/dashboard/summary').expect(200)).body;

  it('1. income increases the correct account balance', async () => {
    const { u, bank, wallet } = await setup();
    await u.post('/transactions', { type: 'income', amount: '50000', accountId: bank.id, categoryId: await category(u, 'Salary'), occurredAt: now() }).expect(201);
    expect(await balance(u, bank.id)).toBe('80000.00');
    expect(await balance(u, wallet.id)).toBe('0.00');
    expect((await summary(u)).monthIncome).toBe('50000.00');
  });

  it('2. expense decreases the correct account balance', async () => {
    const { u, bank, wallet } = await setup();
    await u.post('/transactions', { type: 'expense', amount: '250', accountId: bank.id, categoryId: await category(u, 'Food'), merchant: 'Zomato', occurredAt: now() }).expect(201);
    expect(await balance(u, bank.id)).toBe('29750.00');
    expect(await balance(u, wallet.id)).toBe('0.00');
    expect((await summary(u)).monthExpenses).toBe('250.00');
  });

  it('3. internal transfers do not count as income or expenses', async () => {
    const { u, bank, wallet } = await setup();
    await u.post('/transactions', { type: 'transfer', amount: '2000', accountId: bank.id, destinationAccountId: wallet.id, occurredAt: now() }).expect(201);
    expect(await balance(u, bank.id)).toBe('28000.00');
    expect(await balance(u, wallet.id)).toBe('2000.00');
    const s = await summary(u);
    expect(s.monthIncome).toBe('0.00');
    expect(s.monthExpenses).toBe('0.00');
    expect(s.liquidBalance).toBe('30000.00');
  });

  it('4. reserved money reduces available-to-spend (₹30,000 − ₹8,000 = ₹22,000)', async () => {
    const { u, bank } = await setup();
    const res = await u.post('/commitments', { name: 'Rent', amount: '8000', accountId: bank.id, frequency: 'monthly', dueDate: '2026-12-01' }).expect(201);
    expect(res.body.position).toMatchObject({ liquidBalance: '30000.00', reserved: '8000.00', availableToSpend: '22000.00' });
    const s = await summary(u);
    expect(s.totalBalance).toBe('30000.00'); // the bank balance itself is untouched
    expect(s.availableToSpend).toBe('22000.00');
  });

  it('5. paying a reserved bill does not deduct it twice', async () => {
    const { u, bank } = await setup();
    const { reservation } = (await u.post('/commitments', { name: 'Rent', amount: '8000', accountId: bank.id, frequency: 'monthly', dueDate: '2026-12-01' }).expect(201)).body;
    const paid = await u
      .post('/transactions', { type: 'expense', amount: '8000', accountId: bank.id, categoryId: await category(u, 'Rent'), occurredAt: now(), reservationId: reservation.id })
      .expect(201);
    expect(paid.body.reservation.status).toBe('reconciled');
    const s = await summary(u);
    expect(s.liquidBalance).toBe('22000.00');
    // Next month's rent is reserved automatically, so available = 22,000 − 8,000.
    expect(s.reserved).toBe('8000.00');
    expect(s.availableToSpend).toBe('14000.00');
    const next = (await u.get('/reservations?status=active').expect(200)).body;
    expect(next).toHaveLength(1);
    expect(next[0].dueDate).toBe('2027-01-01');
  });

  it('5b. a different payment amount must be reviewed before reconciling', async () => {
    const { u, bank } = await setup();
    const { reservation } = (await u.post('/commitments', { name: 'Electricity', amount: '1000', accountId: bank.id, frequency: 'once', dueDate: '2026-12-05' }).expect(201)).body;
    const txn = (await u.post('/transactions', { type: 'expense', amount: '1150', accountId: bank.id, categoryId: await category(u, 'Electricity'), occurredAt: now() }).expect(201)).body.transaction;
    const conflict = await u.post(`/reservations/${reservation.id}/settle`, { transactionId: txn.id }).expect(409);
    expect(conflict.body.code).toBe('reservation_amount_mismatch');
    expect(conflict.body.details.difference).toBe('150.00');
    const ok = await u.post(`/reservations/${reservation.id}/settle`, { transactionId: txn.id, acceptDifference: true }).expect(200);
    expect(ok.body.reservation).toMatchObject({ status: 'reconciled', variance: '150.00' });
    expect(ok.body.position).toMatchObject({ liquidBalance: '28850.00', reserved: '0.00', availableToSpend: '28850.00' });
  });

  it('5c. deleting the payment re-holds the reservation', async () => {
    const { u, bank } = await setup();
    const { reservation } = (await u.post('/reservations', { name: 'Internet', accountId: bank.id, targetAmount: '800', dueDate: '2026-12-10' }).expect(201)).body;
    const paid = (await u.post('/transactions', { type: 'expense', amount: '800', accountId: bank.id, occurredAt: now(), reservationId: reservation.id }).expect(201)).body;
    await u.del(`/transactions/${paid.transaction.id}`).expect(204);
    const s = await summary(u);
    expect(s.liquidBalance).toBe('30000.00');
    expect(s.reserved).toBe('800.00');
    expect(s.availableToSpend).toBe('29200.00');
  });

  it('supports partial reservations, release and cancellation', async () => {
    const { u, bank } = await setup();
    const { reservation, position } = (await u.post('/commitments', { name: 'EMI', amount: '3000', accountId: bank.id, frequency: 'monthly', dueDate: '2026-12-15', reserveAmount: '1000' }).expect(201)).body;
    expect(reservation).toMatchObject({ reservedAmount: '1000.00', shortfall: '2000.00', fullyReserved: false });
    expect(position.availableToSpend).toBe('29000.00');
    const adjusted = (await u.patch(`/reservations/${reservation.id}`, { reservedAmount: '3000' }).expect(200)).body;
    expect(adjusted.position.availableToSpend).toBe('27000.00');
    await u.patch(`/reservations/${reservation.id}`, { reservedAmount: '3001' }).expect(422);

    const once = (await u.post('/reservations', { name: 'Gift', accountId: bank.id, targetAmount: '500', dueDate: '2026-12-20' }).expect(201)).body;
    const released = (await u.post(`/reservations/${once.reservation.id}/release`).expect(200)).body;
    expect(released.position.availableToSpend).toBe('27000.00');

    const commitments = (await u.get('/commitments').expect(200)).body;
    const cancelled = (await u.del(`/commitments/${commitments[0].id}`).expect(200)).body;
    expect(cancelled.position).toMatchObject({ reserved: '0.00', availableToSpend: '30000.00' });
  });

  it('flags overcommitment when reservations exceed liquid money', async () => {
    const { u, bank } = await setup();
    const res = (await u.post('/reservations', { name: 'Big bill', accountId: bank.id, targetAmount: '35000', dueDate: '2026-12-20' }).expect(201)).body;
    expect(res.position).toMatchObject({ availableToSpend: '-5000.00', overcommitted: true });
  });

  it('6. duplicate bank transactions are not counted twice', async () => {
    const { u, bank } = await setup();
    const base = { type: 'expense', amount: '450', accountId: bank.id, occurredAt: now(), externalReference: 'UPI-123456789' };
    const first = (await u.post('/transactions', { ...base, source: 'sms' }).expect(201)).body;
    const second = (await u.post('/transactions', { ...base, source: 'statement_import' }).expect(201)).body;
    expect(first.transaction.status).toBe('confirmed');
    expect(second.transaction.status).toBe('duplicate');
    expect(second.duplicateOf).toEqual({ id: first.transaction.id, exact: true });
    expect(await balance(u, bank.id)).toBe('29550.00');
    expect((await summary(u)).monthExpenses).toBe('450.00');
  });

  it('10. same transaction from two sources without a shared reference goes to review', async () => {
    const { u, bank } = await setup();
    const at = new Date();
    await u.post('/transactions', { type: 'expense', amount: '450', accountId: bank.id, occurredAt: at.toISOString(), source: 'sms' }).expect(201);
    const later = new Date(at.getTime() + 3 * 60_000).toISOString();
    const second = (await u.post('/transactions', { type: 'expense', amount: '450', accountId: bank.id, occurredAt: later, source: 'notification' }).expect(201)).body;
    expect(second.transaction.status).toBe('needs_review');
    expect(await balance(u, bank.id)).toBe('29550.00');
    expect((await summary(u)).needsReviewCount).toBe(1);
    // User confirms it really was a second purchase.
    await u.patch(`/transactions/${second.transaction.id}`, { version: second.transaction.version, status: 'confirmed' }).expect(200);
    expect(await balance(u, bank.id)).toBe('29100.00');
  });

  it('7. credit card purchase is an expense; the bill payment is not a second expense', async () => {
    const { u, bank, card } = await setup();
    await u.post('/transactions', { type: 'expense', amount: '5000', accountId: card.id, categoryId: await category(u, 'Shopping'), occurredAt: now() }).expect(201);
    let c = (await u.get(`/accounts/${card.id}`).expect(200)).body;
    expect(c).toMatchObject({ balance: '-5000.00', outstanding: '5000.00', availableCredit: '45000.00' });
    expect((await summary(u)).creditCardOutstanding).toBe('5000.00');

    await u.post('/transactions', { type: 'transfer', amount: '5000', accountId: bank.id, destinationAccountId: card.id, occurredAt: now() }).expect(201);
    c = (await u.get(`/accounts/${card.id}`).expect(200)).body;
    expect(c.outstanding).toBe('0.00');
    const s = await summary(u);
    expect(s.monthExpenses).toBe('5000.00');
    expect(s.liquidBalance).toBe('25000.00');
    expect(s.creditCardOutstanding).toBe('0.00');
  });

  it('8. editing a transaction recalculates balances and keeps an audit trail', async () => {
    const { u, bank, wallet } = await setup();
    const created = (await u.post('/transactions', { type: 'expense', amount: '1000', accountId: bank.id, occurredAt: now() }).expect(201)).body.transaction;
    const edited = (await u.patch(`/transactions/${created.id}`, { version: 1, amount: '1200', accountId: wallet.id }).expect(200)).body;
    expect(edited.version).toBe(2);
    expect(await balance(u, bank.id)).toBe('30000.00');
    expect(await balance(u, wallet.id)).toBe('-1200.00');
    expect((await summary(u)).monthExpenses).toBe('1200.00');
    // Stale edits are rejected.
    await u.patch(`/transactions/${created.id}`, { version: 1, amount: '5' }).expect(409);
    const history = (await u.get(`/transactions/${created.id}/history`).expect(200)).body;
    expect(history.map((h: any) => h.action)).toEqual(['created', 'updated']);
    await u.del(`/transactions/${created.id}`).expect(204);
    expect(await balance(u, wallet.id)).toBe('0.00');
    expect((await u.get(`/transactions/${created.id}/history`).expect(200)).body.map((h: any) => h.action)).toEqual(['created', 'updated', 'deleted']);
  });

  it('9. failed transactions are not treated as successful expenses', async () => {
    const { u, bank } = await setup();
    await u.post('/transactions', { type: 'expense', amount: '999', accountId: bank.id, occurredAt: now(), source: 'sms', status: 'failed' }).expect(201);
    expect(await balance(u, bank.id)).toBe('30000.00');
    expect((await summary(u)).monthExpenses).toBe('0.00');
  });

  it('rejects invalid input with field-level messages', async () => {
    const { u, bank } = await setup();
    const res = await u.post('/transactions', { type: 'expense', amount: '-5', accountId: bank.id, occurredAt: 'yesterday' }).expect(400);
    expect(res.body.code).toBe('validation_failed');
    expect(Object.keys(res.body.fields)).toEqual(expect.arrayContaining(['amount', 'occurredAt']));
    await u.post('/transactions', { type: 'expense', amount: '0.001', accountId: bank.id, occurredAt: now() }).expect(400);
    await u.post('/transactions', { type: 'transfer', amount: '10', accountId: bank.id, destinationAccountId: bank.id, occurredAt: now() }).expect(422);
    await u.post('/transactions', { type: 'income', amount: '10', accountId: bank.id, categoryId: await category(u, 'Food'), occurredAt: now() }).expect(422);
    await u.post('/accounts', { name: 'x', type: 'savings', accountMask: '123456789012' }).expect(400);
  });

  it('expense intelligence compares the category with last month', async () => {
    const { u, bank } = await setup();
    const food = await category(u, 'Food');
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    await u.post('/transactions', { type: 'expense', amount: '300', accountId: bank.id, categoryId: food, occurredAt: lastMonth.toISOString() }).expect(201);
    const t1 = (await u.post('/transactions', { type: 'expense', amount: '500', accountId: bank.id, categoryId: food, occurredAt: now() }).expect(201)).body.transaction;
    const detail = (await u.get(`/transactions/${t1.id}`).expect(200)).body;
    expect(detail.isEssential).toBe(false);
    expect(detail.insight).toMatchObject({ categorySpentThisMonth: '500.00', categorySpentLastMonth: '300.00', changeFromLastMonth: '200.00' });
  });

  it('accounts with history can only be archived; reconcile reports the gap', async () => {
    const { u, bank, wallet } = await setup();
    await u.post('/transactions', { type: 'expense', amount: '100', accountId: bank.id, occurredAt: now() }).expect(201);
    await u.del(`/accounts/${bank.id}`).expect(409);
    await u.del(`/accounts/${wallet.id}`).expect(204);
    const rec = (await u.post(`/accounts/${bank.id}/reconcile`, { actualBalance: '29850' }).expect(200)).body;
    expect(rec).toMatchObject({ trackedBalance: '29900.00', difference: '-50.00', matches: false });
    await u.patch(`/accounts/${bank.id}`, { archived: true }).expect(200);
    await u.post('/transactions', { type: 'expense', amount: '1', accountId: bank.id, occurredAt: now() }).expect(422);
  });
});
