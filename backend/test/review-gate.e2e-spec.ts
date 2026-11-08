import { AuditService } from '../src/audit/audit.service';
import { category, createTestApp, now, registerUser, TestApp, TestUser } from './helpers';

/** Tests for the Priority 3 gate review (B1–B5, E). */
const ist = (date: string, time = '12:00:00') => `${date}T${time}+05:30`;
const SINCE = { trackingStartDate: '2026-01-01' };

async function bankUser(t: TestApp, opening = '30000') {
  const u = await registerUser(t);
  const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: opening, ...SINCE }).expect(201)).body;
  return { u, bank };
}
const summary = async (u: TestUser) => (await u.get('/dashboard/summary').expect(200)).body;
const active = async (u: TestUser) => (await u.get('/reservations?status=active').expect(200)).body;

describe('B1 · Reservation lifecycle', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  async function rent(u: TestUser, bankId: string) {
    const res = (await u.post('/commitments', { name: 'Rent', amount: '8000', accountId: bankId, frequency: 'monthly', dueDate: '2026-11-01' }).expect(201)).body;
    return res;
  }
  const pay = (u: TestUser, bankId: string, reservationId: string, amount = '8000') =>
    u.post('/transactions', { type: 'expense', amount, accountId: bankId, occurredAt: now(), reservationId, acceptReservationDifference: true }).expect(201);

  it('deleting a payment restores the exact pre-payment state (no double reservation)', async () => {
    const { u, bank } = await bankUser(t);
    const { commitment, reservation: nov } = await rent(u, bank.id);
    const paid = (await pay(u, bank.id, nov.id)).body;
    let open = await active(u);
    expect(open.map((r: any) => r.occurrenceDate)).toEqual(['2026-12-01']);
    const dec = open[0];
    expect(dec.createdFromReservationId).toBe(nov.id);

    await u.del(`/transactions/${paid.transaction.id}`).expect(204);
    open = await active(u);
    expect(open.map((r: any) => [r.id, r.occurrenceDate])).toEqual([[nov.id, '2026-11-01']]);
    const all = (await u.get('/reservations').expect(200)).body;
    expect(all.find((r: any) => r.id === dec.id)).toMatchObject({ status: 'cancelled', closeReason: 'superseded_by_payment_reversal' });
    expect((await u.get('/commitments').expect(200)).body[0]).toMatchObject({ id: commitment.id, nextDueDate: '2026-11-01' });
    const s = await summary(u);
    expect(s).toMatchObject({ liquidBalance: '30000.00', reserved: '8000.00', availableToSpend: '22000.00' });

    const history = (await u.get(`/reservations/${nov.id}/settlements`).expect(200)).body;
    expect(history).toEqual([expect.objectContaining({ transactionId: paid.transaction.id, status: 'reversed', reversalReason: 'payment_deleted' })]);

    // Paying again schedules a fresh December occurrence.
    await pay(u, bank.id, nov.id);
    open = await active(u);
    expect(open.map((r: any) => r.occurrenceDate)).toEqual(['2026-12-01']);
    expect(open[0].id).not.toBe(dec.id);
    expect((await summary(u)).availableToSpend).toBe('14000.00');
  });

  it('a later occurrence that was already paid is kept; the reopened one is a separate obligation', async () => {
    const { u, bank } = await bankUser(t);
    const { reservation: nov } = await rent(u, bank.id);
    const novPaid = (await pay(u, bank.id, nov.id)).body;
    const dec = (await active(u))[0];
    await pay(u, bank.id, dec.id);
    expect((await active(u)).map((r: any) => r.occurrenceDate)).toEqual(['2027-01-01']);

    await u.del(`/transactions/${novPaid.transaction.id}`).expect(204);
    const open = await active(u);
    expect(open.map((r: any) => r.occurrenceDate)).toEqual(['2026-11-01', '2027-01-01']);
    const reservations = (await u.get('/reservations').expect(200)).body;
    expect(reservations.find((r: any) => r.id === dec.id).status).toBe('reconciled');

    // Re-paying November must not create another occurrence: January is already scheduled.
    await pay(u, bank.id, nov.id);
    expect((await active(u)).map((r: any) => r.occurrenceDate)).toEqual(['2027-01-01']);
  });

  it('unconfirming or retyping a payment also reverses the settlement', async () => {
    const { u, bank } = await bankUser(t);
    const { reservation: nov } = await rent(u, bank.id);
    const paid = (await pay(u, bank.id, nov.id)).body.transaction;
    await u.patch(`/transactions/${paid.id}`, { version: paid.version, status: 'ignored' }).expect(200);
    expect((await active(u)).map((r: any) => r.id)).toEqual([nov.id]);
    expect((await u.get(`/reservations/${nov.id}/settlements`).expect(200)).body[0].reversalReason).toBe('payment_status_ignored');

    const second = (await pay(u, bank.id, nov.id)).body.transaction;
    await u.patch(`/transactions/${second.id}`, { version: second.version, type: 'income' }).expect(200);
    expect((await active(u)).map((r: any) => r.id)).toEqual([nov.id]);
    expect((await u.get(`/reservations/${nov.id}/settlements`).expect(200)).body.map((s: any) => s.reversalReason)).toEqual(['payment_status_ignored', 'payment_type_changed']);
  });

  it('correcting the payment amount keeps the settlement in sync', async () => {
    const { u, bank } = await bankUser(t);
    const { reservation: nov } = await rent(u, bank.id);
    const paid = (await pay(u, bank.id, nov.id)).body.transaction;
    await u.patch(`/transactions/${paid.id}`, { version: paid.version, amount: '8100' }).expect(200);
    const [s] = (await u.get(`/reservations/${nov.id}/settlements`).expect(200)).body;
    expect(s).toMatchObject({ status: 'active', amount: '8100.00', variance: '100.00' });
  });

  it('the database refuses two live reservations for the same occurrence', async () => {
    const { u, bank } = await bankUser(t);
    const { reservation } = await rent(u, bank.id);
    const row = await t.db.selectFrom('money_reservations').selectAll().where('id', '=', reservation.id).executeTakeFirstOrThrow();
    const { id, created_at, updated_at, ...copy } = row;
    await expect(t.db.insertInto('money_reservations').values(copy).execute()).rejects.toThrow();
  });

  it('concurrent reversal and successor payment leave a consistent state', async () => {
    const { u, bank } = await bankUser(t);
    const { reservation: nov } = await rent(u, bank.id);
    const novPaid = (await pay(u, bank.id, nov.id)).body.transaction;
    const dec = (await active(u))[0];
    const decTxn = (await u.post('/transactions', { type: 'expense', amount: '8000', accountId: bank.id, occurredAt: now() }).expect(201)).body.transaction;
    const [del, settle] = await Promise.all([u.del(`/transactions/${novPaid.id}`), u.post(`/reservations/${dec.id}/settle`, { transactionId: decTxn.id })]);
    expect(del.status).toBe(204);
    const open = (await active(u)).map((r: any) => r.occurrenceDate);
    if (settle.status === 200) {
      expect(open).toEqual(['2026-11-01', '2027-01-01']); // December paid first, then November reversed
    } else {
      expect(settle.status).toBe(409); // November reversed first, December cancelled
      expect(open).toEqual(['2026-11-01']);
    }
    // Invariant: available-to-spend equals liquid balance minus exactly the live reservations.
    const s = await summary(u);
    const held = (await active(u)).reduce((acc: number, r: any) => acc + Number(r.reservedAmount), 0);
    expect(Number(s.liquidBalance) - held).toBe(Number(s.availableToSpend));
  });

  it('concurrent deletes of the same payment reverse it once', async () => {
    const { u, bank } = await bankUser(t);
    const { reservation: nov } = await rent(u, bank.id);
    const paid = (await pay(u, bank.id, nov.id)).body.transaction;
    const results = await Promise.all([1, 2, 3].map(() => u.del(`/transactions/${paid.id}`)));
    expect(results.map((r) => r.status).sort()).toEqual([204, 404, 404]);
    expect((await active(u)).map((r: any) => r.id)).toEqual([nov.id]);
    expect((await u.get(`/reservations/${nov.id}/settlements`).expect(200)).body.filter((s: any) => s.status === 'reversed')).toHaveLength(1);
  });

  it('a failure during reversal rolls back the deletion entirely', async () => {
    const { u, bank } = await bankUser(t);
    const { reservation: nov } = await rent(u, bank.id);
    const paid = (await pay(u, bank.id, nov.id)).body.transaction;
    const before = await summary(u);
    const audit = t.app.get(AuditService);
    const original = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (db, entry) => {
      if (entry.action === 'reopened') throw new Error('simulated failure');
      return original(db, entry);
    });
    try {
      const res = await u.del(`/transactions/${paid.id}`).expect(500);
      expect(res.body).toEqual({ statusCode: 500, code: 'internal_error', message: expect.any(String) });
    } finally {
      spy.mockRestore();
    }
    await u.get(`/transactions/${paid.id}`).expect(200);
    expect(await summary(u)).toMatchObject({ liquidBalance: before.liquidBalance, reserved: before.reserved, availableToSpend: before.availableToSpend });
    expect((await active(u)).map((r: any) => r.occurrenceDate)).toEqual(['2026-12-01']);
    expect((await u.get(`/reservations/${nov.id}/settlements`).expect(200)).body[0].status).toBe('active');
  });
});

describe('B2 · Goal allocation', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('new goals are track-only by default; reserve mode is opt-in', async () => {
    const { u } = await bankUser(t);
    const { goal, position } = (await u.post('/goals', { name: 'Trip', targetAmount: '20000', initialAmount: '5000' }).expect(201)).body;
    expect(goal).toMatchObject({ allocationMode: 'track_only', saved: '5000.00', allocated: '0.00' });
    expect(position.availableToSpend).toBe('30000.00');
    const switched = (await u.patch(`/goals/${goal.id}`, { allocationMode: 'reserve' }).expect(200)).body;
    expect(switched.goal.allocated).toBe('5000.00');
    expect(switched.position.availableToSpend).toBe('25000.00');
  });

  it('a linked transfer to a separate liquid account is deducted once', async () => {
    const { u, bank } = await bankUser(t);
    const pot = (await u.post('/accounts', { name: 'Goal savings', type: 'savings', ...SINCE }).expect(201)).body;
    const { goal } = (await u.post('/goals', { name: 'Laptop', targetAmount: '60000', accountId: pot.id, allocationMode: 'reserve' }).expect(201)).body;
    const transfer = (await u.post('/transactions', { type: 'transfer', amount: '5000', accountId: bank.id, destinationAccountId: pot.id, occurredAt: now() }).expect(201)).body.transaction;
    const r = (await u.post(`/goals/${goal.id}/contributions`, { type: 'contribution', amount: '5000', transactionId: transfer.id }).expect(201)).body;
    expect(r.goal).toMatchObject({ saved: '5000.00', allocated: '5000.00', movedByTransfers: '5000.00' });
    expect(r.position).toMatchObject({ liquidBalance: '30000.00', allocated: '5000.00', availableToSpend: '25000.00' });
    // The same transfer cannot back a second contribution.
    expect((await u.post(`/goals/${goal.id}/contributions`, { type: 'contribution', amount: '5000', transactionId: transfer.id }).expect(409)).body.code).toBe('bank_movement_already_linked');
    // Direction and amount must match.
    const back = (await u.post('/transactions', { type: 'transfer', amount: '100', accountId: pot.id, destinationAccountId: bank.id, occurredAt: now() }).expect(201)).body.transaction;
    expect((await u.post(`/goals/${goal.id}/contributions`, { type: 'contribution', amount: '100', transactionId: back.id }).expect(422)).body.code).toBe('invalid_bank_movement');
    const other = (await u.post('/transactions', { type: 'transfer', amount: '700', accountId: bank.id, destinationAccountId: pot.id, occurredAt: now() }).expect(201)).body.transaction;
    expect((await u.post(`/goals/${goal.id}/contributions`, { type: 'contribution', amount: '500', transactionId: other.id }).expect(422)).body.code).toBe('bank_movement_amount_mismatch');
  });

  it('money moved to a non-liquid account is not deducted twice', async () => {
    const { u, bank } = await bankUser(t);
    const locked = (await u.post('/accounts', { name: 'Locked savings', type: 'savings', isLiquid: false, ...SINCE }).expect(201)).body;
    const { goal } = (await u.post('/goals', { name: 'House', targetAmount: '500000', accountId: locked.id, allocationMode: 'reserve' }).expect(201)).body;
    const transfer = (await u.post('/transactions', { type: 'transfer', amount: '5000', accountId: bank.id, destinationAccountId: locked.id, occurredAt: now() }).expect(201)).body.transaction;
    const r = (await u.post(`/goals/${goal.id}/contributions`, { type: 'contribution', amount: '5000', transactionId: transfer.id }).expect(201)).body;
    expect(r.goal.allocated).toBe('0.00');
    expect(r.position).toMatchObject({ liquidBalance: '25000.00', allocated: '0.00', availableToSpend: '25000.00' });
  });

  it('contributions are reversed by an opposite entry, once', async () => {
    const { u } = await bankUser(t);
    const { goal } = (await u.post('/goals', { name: 'Fund', targetAmount: '10000', allocationMode: 'reserve' }).expect(201)).body;
    const c1 = (await u.post(`/goals/${goal.id}/contributions`, { type: 'contribution', amount: '3000' }).expect(201)).body;
    const detail = (await u.get(`/goals/${goal.id}`).expect(200)).body;
    const cid = detail.contributions[0].id;
    const rev = (await u.post(`/goals/${goal.id}/contributions/${cid}/reverse`).expect(201)).body;
    expect(rev.goal.saved).toBe('0.00');
    expect(rev.position.availableToSpend).toBe(String(Number(c1.position.availableToSpend) + 3000) + '.00');
    expect((await u.post(`/goals/${goal.id}/contributions/${cid}/reverse`).expect(409)).body.code).toBe('already_reversed');
    const after = (await u.get(`/goals/${goal.id}`).expect(200)).body;
    expect(after.contributions.map((c: any) => [c.type, c.reversed])).toEqual([
      ['reversal', false],
      ['contribution', true],
    ]);
    const reversalId = after.contributions[0].id;
    expect((await u.post(`/goals/${goal.id}/contributions/${reversalId}/reverse`).expect(409)).body.code).toBe('cannot_reverse_reversal');
    // A reversal may not push the goal below zero.
    await u.post(`/goals/${goal.id}/contributions`, { type: 'contribution', amount: '1000' }).expect(201);
    await u.post(`/goals/${goal.id}/contributions`, { type: 'withdrawal', amount: '1000' }).expect(201);
    const latest = (await u.get(`/goals/${goal.id}`).expect(200)).body.contributions;
    const deposit = latest.find((c: any) => c.type === 'contribution' && !c.reversed && c.amount === '1000.00');
    expect((await u.post(`/goals/${goal.id}/contributions/${deposit.id}/reverse`).expect(422)).body.code).toBe('reversal_exceeds_saved');
  });

  it('contributions are idempotent', async () => {
    const { u } = await bankUser(t);
    const { goal } = (await u.post('/goals', { name: 'Fund', targetAmount: '10000' }).expect(201)).body;
    const send = () => u.post(`/goals/${goal.id}/contributions`, { type: 'contribution', amount: '250' }).set('Idempotency-Key', `goal-${goal.id.slice(0, 8)}-1`);
    const first = (await send().expect(201)).body;
    const second = (await send().expect(201)).body;
    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect((await u.get(`/goals/${goal.id}`).expect(200)).body.saved).toBe('250.00');
  });
});

describe('B3 · Budget health vs threshold events', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('health follows the lowest threshold; events stay separate and idempotent', async () => {
    const { u, bank } = await bankUser(t);
    const b = (await u.post('/budgets', { name: 'All', period: 'monthly', amount: '1000', alertThresholds: [80, 95] }).expect(201)).body;
    const r1 = (await u.post('/transactions', { type: 'expense', amount: '700', accountId: bank.id, occurredAt: now() }).expect(201)).body;
    expect(r1.budgetAlerts).toEqual([]);
    expect((await u.get(`/budgets/${b.id}`).expect(200)).body.current).toMatchObject({ health: 'on_track', healthWarningFromPercent: 80 });
    const r2 = (await u.post('/transactions', { type: 'expense', amount: '100', accountId: bank.id, occurredAt: now() }).expect(201)).body;
    expect(r2.budgetAlerts.map((a: any) => a.threshold)).toEqual([80]);
    expect((await u.get(`/budgets/${b.id}`).expect(200)).body.current.health).toBe('warning');
    // Editing the thresholds never re-fires an event already recorded for this period.
    await u.patch(`/budgets/${b.id}`, { alertThresholds: [50, 80] }).expect(200);
    const r3 = (await u.post('/transactions', { type: 'expense', amount: '1', accountId: bank.id, occurredAt: now() }).expect(201)).body;
    expect(r3.budgetAlerts.map((a: any) => a.threshold)).toEqual([50]);
  });
});

describe('B4 · Account tracking dates and historical imports', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  async function setup() {
    const u = await registerUser(t);
    const bank = (await u.post('/accounts', { name: 'HDFC', type: 'savings', openingBalance: '10000', openingDate: '2019-04-01', trackingStartDate: '2026-11-01' }).expect(201)).body;
    return { u, bank };
  }

  it('rejects manual transactions before tracking starts', async () => {
    const { u, bank } = await setup();
    expect(bank).toMatchObject({ openingDate: '2019-04-01', trackingStartDate: '2026-11-01' });
    const res = await u.post('/transactions', { type: 'expense', amount: '100', accountId: bank.id, occurredAt: ist('2026-10-31', '23:59:00') }).expect(422);
    expect(res.body.code).toBe('before_tracking_start');
    await u.post('/transactions', { type: 'expense', amount: '100', accountId: bank.id, occurredAt: ist('2026-11-01', '00:00:30') }).expect(201);
    // A transfer is rejected if either side was not tracked yet.
    const wallet = (await u.post('/accounts', { name: 'Wallet', type: 'wallet', trackingStartDate: '2026-11-05' }).expect(201)).body;
    expect((await u.post('/transactions', { type: 'transfer', amount: '50', accountId: bank.id, destinationAccountId: wallet.id, occurredAt: ist('2026-11-03') }).expect(422)).body.code).toBe('before_tracking_start');
    // Editing a live transaction to an earlier date is rejected too.
    const live = (await u.post('/transactions', { type: 'expense', amount: '10', accountId: bank.id, occurredAt: ist('2026-11-02') }).expect(201)).body.transaction;
    expect((await u.patch(`/transactions/${live.id}`, { version: live.version, occurredAt: ist('2026-10-15') }).expect(422)).body.code).toBe('before_tracking_start');
  });

  it('accepts explicit historical imports that feed analytics but never the balance', async () => {
    const { u, bank } = await setup();
    const food = await category(u, 'Food');
    const budget = (await u.post('/budgets', { name: 'Food', categoryId: food, period: 'monthly', amount: '5000', startDate: '2026-10-01' }).expect(201)).body;
    const h = (await u.post('/transactions', { type: 'expense', amount: '1200', accountId: bank.id, categoryId: food, occurredAt: ist('2026-10-20'), source: 'statement_import', historical: true, externalReference: 'STMT-1' }).expect(201)).body.transaction;
    expect(h).toMatchObject({ isHistorical: true, status: 'confirmed' });
    expect((await u.get(`/accounts/${bank.id}`).expect(200)).body.balance).toBe('10000.00');
    expect((await u.get(`/budgets/${budget.id}?asOf=2026-10-25`).expect(200)).body.current.spent).toBe('1200.00');
    // Dedup still applies to historical lines.
    const dup = (await u.post('/transactions', { type: 'expense', amount: '1200', accountId: bank.id, occurredAt: ist('2026-10-20'), source: 'statement_import', historical: true, externalReference: 'STMT-1' }).expect(201)).body;
    expect(dup.transaction.status).toBe('duplicate');
  });

  it('validates historical imports', async () => {
    const { u, bank } = await setup();
    const base = { type: 'expense', amount: '10', accountId: bank.id, historical: true };
    expect((await u.post('/transactions', { ...base, occurredAt: ist('2026-10-20') }).expect(422)).body.code).toBe('historical_source');
    expect((await u.post('/transactions', { ...base, occurredAt: ist('2026-11-02'), source: 'statement_import' }).expect(422)).body.code).toBe('not_historical');
    const { reservation } = (await u.post('/reservations', { name: 'X', accountId: bank.id, targetAmount: '10', dueDate: '2026-12-01' }).expect(201)).body;
    expect((await u.post('/transactions', { ...base, occurredAt: ist('2026-10-20'), source: 'statement_import', reservationId: reservation.id }).expect(422)).body.code).toBe('historical_settlement');
  });
});

describe('B5 · Forecast v2', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('a past asOf uses the balance as of that date', async () => {
    const u = await registerUser(t);
    const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: '10000', trackingStartDate: '2026-10-01' }).expect(201)).body;
    await u.post('/transactions', { type: 'expense', amount: '2000', accountId: bank.id, occurredAt: ist('2026-10-15') }).expect(201);
    await u.post('/transactions', { type: 'income', amount: '5000', accountId: bank.id, occurredAt: ist('2026-11-03') }).expect(201);
    const past = (await u.get('/forecast/month-end?asOf=2026-10-20').expect(200)).body;
    expect(past).toMatchObject({ methodVersion: 'forecast-v2', asOf: '2026-10-20', monthEnd: '2026-10-31', startingLiquidBalance: '8000.00' });
    expect(new Date(past.calculatedAt).toString()).not.toBe('Invalid Date');
    expect(past.assumptions.join(' ')).toContain('historical forecast');
    const beforeTracking = (await u.get('/forecast/month-end?asOf=2026-09-15').expect(200)).body;
    expect(beforeTracking.startingLiquidBalance).toBe('0.00');
    expect((await u.get('/forecast/month-end?asOf=2999-01-01').expect(422)).body.code).toBe('forecast_future_as_of');
  });

  it('weights recent spending 50/30/20', async () => {
    const u = await registerUser(t);
    const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: '50000', trackingStartDate: '2026-01-01' }).expect(201)).body;
    const spend = (amount: string, d: string) => u.post('/transactions', { type: 'expense', amount, accountId: bank.id, occurredAt: ist(d) }).expect(201);
    await spend('1200', '2026-08-10'); // days 31–90: ₹20/day over 60 days
    await spend('1150', '2026-10-20'); // days 8–30: ₹50/day over 23 days
    await spend('700', '2026-11-05'); // last 7 days: ₹100/day
    const f = (await u.get('/forecast/month-end?asOf=2026-11-08').expect(200)).body;
    expect(f.variableSpending).toMatchObject({ method: 'weighted_recent', historyDays: 90, dailyAverage: '69.00' });
    expect(f.variableSpending.windows.map((w: any) => [w.label, w.coveredDays, w.weight])).toEqual([
      ['last_7_days', 7, 0.5],
      ['days_8_to_30', 23, 0.3],
      ['days_31_to_90', 60, 0.2],
    ]);
    expect(f.confidence).toBe('high');
  });

  it('does not double-count recurring expenses, commitments or planned spending', async () => {
    const u = await registerUser(t);
    const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: '50000', trackingStartDate: '2026-01-01' }).expect(201)).body;
    await u.post('/transactions', { type: 'expense', amount: '649', accountId: bank.id, merchant: 'Netflix', isRecurring: true, occurredAt: ist('2026-10-12') }).expect(201);
    await u.post('/commitments', { name: 'Netflix', amount: '649', accountId: bank.id, frequency: 'monthly', dueDate: '2026-11-12' }).expect(201);
    await u.post('/transactions', { type: 'expense', amount: '9000', accountId: bank.id, isPlanned: true, occurredAt: ist('2026-11-02') }).expect(201);
    await u.post('/transactions', { type: 'expense', amount: '300', accountId: bank.id, occurredAt: ist('2026-11-05') }).expect(201);
    const f = (await u.get('/forecast/month-end?asOf=2026-11-08').expect(200)).body;
    expect(f.expectedRecurringExpenses.items).toEqual([]);
    expect(f.scheduledPayments.items).toEqual([{ name: 'Netflix', amount: '649.00', date: '2026-11-12' }]);
    expect(f.variableSpending).toMatchObject({ method: 'simple_average', dailyAverage: '100.00' }); // 300 over 3 days; the planned 9,000 is excluded
    expect(f.assumptions.join(' ')).toContain('(Netflix) are counted once');
  });
});

describe('E · API contract', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  const expectErrorShape = (body: any, status: number, code: string) => {
    expect(body).toMatchObject({ statusCode: status, code, message: expect.any(String) });
    expect(body.error).toBeUndefined();
  };

  it('every error has { statusCode, code, message }', async () => {
    const { u } = await bankUser(t);
    expectErrorShape((await t.http().get('/api/v1/accounts').expect(401)).body, 401, 'unauthorized');
    expectErrorShape((await u.get('/accounts/not-a-uuid').expect(400)).body, 400, 'bad_request');
    expectErrorShape((await u.get('/accounts/00000000-0000-4000-8000-000000000000').expect(404)).body, 404, 'not_found');
    expectErrorShape((await u.get('/no-such-route').expect(404)).body, 404, 'not_found');
    const v = (await u.post('/accounts', { name: '', type: 'x', extra: 1 }).expect(400)).body;
    expectErrorShape(v, 400, 'validation_failed');
    expect(Object.keys(v.fields)).toEqual(expect.arrayContaining(['name', 'type', 'extra']));
  });

  it('paginates and sorts with no overlap between pages', async () => {
    const { u, bank } = await bankUser(t);
    for (const a of ['5', '1', '4', '2', '3']) await u.post('/transactions', { type: 'expense', amount: a, accountId: bank.id, occurredAt: now() }).expect(201);
    const pages = [];
    for (const page of [1, 2, 3]) pages.push((await u.get(`/transactions?sort=amount:asc&pageSize=2&page=${page}`).expect(200)).body);
    expect(pages.flatMap((p) => p.items.map((i: any) => i.amount))).toEqual(['1.00', '2.00', '3.00', '4.00', '5.00']);
    expect(pages[0]).toMatchObject({ total: 5, page: 1, pageSize: 2, sort: 'amount:asc' });
    await u.get('/transactions?sort=merchant:asc').expect(400);
  });

  it('Idempotency-Key makes transaction creation safe to replay', async () => {
    const { u, bank } = await bankUser(t, '1000');
    const body = { type: 'expense', amount: '100', accountId: bank.id, occurredAt: now() };
    const key = 'offline-queue-0001';
    const a = (await u.post('/transactions', body).set('Idempotency-Key', key).expect(201)).body;
    const b = (await u.post('/transactions', body).set('Idempotency-Key', key).expect(201)).body;
    expect(b.transaction.id).toBe(a.transaction.id);
    expect([a.idempotentReplay, b.idempotentReplay]).toEqual([false, true]);
    expectErrorShape((await u.post('/transactions', { ...body, amount: '200' }).set('Idempotency-Key', key).expect(422)).body, 422, 'idempotency_key_reused');
    await u.post('/transactions', body).set('Idempotency-Key', 'bad key!').expect(400);

    const concurrent = await Promise.all([1, 2, 3].map(() => u.post('/transactions', body).set('Idempotency-Key', 'offline-queue-0002')));
    const ids = new Set(concurrent.filter((r) => r.status === 201).map((r) => r.body.transaction.id));
    expect(ids.size).toBe(1);
    expect(concurrent.every((r) => r.status === 201 || (r.status === 409 && r.body.code === 'idempotency_in_progress'))).toBe(true);
    expect((await u.get(`/accounts/${bank.id}`).expect(200)).body.balance).toBe('800.00');
    // Keys are per user.
    const other = await bankUser(t);
    await other.u.post('/transactions', { ...body, accountId: other.bank.id }).set('Idempotency-Key', key).expect(201);
  });

  it('money is a 2-decimal string and timestamps are ISO 8601', async () => {
    const { u, bank } = await bankUser(t);
    const tx = (await u.post('/transactions', { type: 'income', amount: '7.5', accountId: bank.id, occurredAt: '2026-11-08T10:00:00+05:30' }).expect(201)).body.transaction;
    expect(tx.amount).toBe('7.50');
    expect(tx.occurredAt).toBe('2026-11-08T04:30:00.000Z');
    const s = await summary(u);
    for (const k of ['totalBalance', 'liquidBalance', 'reserved', 'allocated', 'availableToSpend', 'creditCardOutstanding', 'monthIncome', 'monthExpenses', 'savings']) {
      expect(s[k]).toMatch(/^-?\d+\.\d{2}$/);
    }
  });
});
