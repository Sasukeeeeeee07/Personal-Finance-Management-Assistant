import { addDays } from '../src/common/dates';
import { category, createTestApp, now, registerUser, setCommitmentsCreatedAt, TestApp, TestUser } from './helpers';

const ist = (date: string, time = '12:00:00') => `${date}T${time}+05:30`;

describe('Budgets', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  async function setup() {
    const u = await registerUser(t);
    const since = { trackingStartDate: '2026-01-01' };
    const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: '30000', ...since }).expect(201)).body;
    const card = (await u.post('/accounts', { name: 'Card', type: 'credit_card', ...since }).expect(201)).body;
    const wallet = (await u.post('/accounts', { name: 'Wallet', type: 'wallet', ...since }).expect(201)).body;
    return { u, bank, card, wallet, food: await category(u, 'Food') };
  }
  const spend = (u: TestUser, accountId: string, amount: string, occurredAt: string, categoryId?: string, extra: object = {}) =>
    u.post('/transactions', { type: 'expense', amount, accountId, occurredAt, categoryId, ...extra }).expect(201);

  it('food budget ₹4,000 minus ₹2,500 spent leaves ₹1,500, with a 50% alert fired once', async () => {
    const { u, bank, food } = await setup();
    const budget = (await u.post('/budgets', { name: 'Food', categoryId: food, period: 'monthly', amount: '4000' }).expect(201)).body;
    expect(budget.current).toMatchObject({ limit: '4000.00', spent: '0.00', remaining: '4000.00' });

    const first = (await spend(u, bank.id, '2500', now(), food)).body;
    expect(first.budgetAlerts).toEqual([expect.objectContaining({ budgetId: budget.id, kind: 'threshold', threshold: 50 })]);
    expect(first.budgetAlerts[0].message).toContain('₹1500.00 left');

    const b = (await u.get(`/budgets/${budget.id}`).expect(200)).body;
    expect(b.current).toMatchObject({ spent: '2500.00', remaining: '1500.00', utilizationPercent: '62.50', thresholdsReached: [50], health: 'warning', healthWarningFromPercent: 50 });

    const second = (await spend(u, bank.id, '10', now(), food)).body;
    expect(second.budgetAlerts).toEqual([]); // 50% does not fire again in the same period

    const third = (await spend(u, bank.id, '1500', now(), food)).body;
    expect(third.budgetAlerts.map((a: any) => [a.kind, a.threshold])).toEqual([
      ['threshold', 75],
      ['threshold', 90],
      ['threshold', 100],
      ['exceeded', 100],
    ]);
    const alerts = (await u.get('/budgets/alerts').expect(200)).body;
    expect(alerts).toHaveLength(5);

    // Expense intelligence now reports budget impact.
    const detail = (await u.get(`/transactions/${third.transaction.id}`).expect(200)).body;
    expect(detail.insight.budget).toMatchObject({ id: budget.id, current: expect.objectContaining({ remaining: '-10.00', exceeded: true, health: 'exceeded' }) });
  });

  it('transfers, card bill payments and income never consume a budget', async () => {
    const { u, bank, card, wallet } = await setup();
    const overall = (await u.post('/budgets', { name: 'Everything', period: 'monthly', amount: '10000' }).expect(201)).body;
    await u.post('/transactions', { type: 'transfer', amount: '2000', accountId: bank.id, destinationAccountId: wallet.id, occurredAt: now() }).expect(201);
    await spend(u, card.id, '1200', now());
    await u.post('/transactions', { type: 'transfer', amount: '1200', accountId: bank.id, destinationAccountId: card.id, occurredAt: now() }).expect(201);
    await u.post('/transactions', { type: 'income', amount: '5000', accountId: bank.id, occurredAt: now() }).expect(201);
    const b = (await u.get(`/budgets/${overall.id}`).expect(200)).body;
    expect(b.current.spent).toBe('1200.00'); // only the card purchase
    const s = (await u.get('/dashboard/summary').expect(200)).body;
    expect(s.monthlyBudget).toMatchObject({ budgetId: overall.id, spent: '1200.00', remaining: '8800.00' });
  });

  it('failed, duplicate, edited and deleted expenses are reflected correctly', async () => {
    const { u, bank, food } = await setup();
    const budget = (await u.post('/budgets', { name: 'Food', categoryId: food, period: 'monthly', amount: '4000' }).expect(201)).body;
    await spend(u, bank.id, '300', now(), food, { source: 'sms', status: 'failed' });
    const real = (await spend(u, bank.id, '400', now(), food, { externalReference: 'REF-1', source: 'sms' })).body.transaction;
    await spend(u, bank.id, '400', now(), food, { externalReference: 'REF-1', source: 'statement_import' }); // duplicate
    let b = (await u.get(`/budgets/${budget.id}`).expect(200)).body;
    expect(b.current.spent).toBe('400.00');
    await u.patch(`/transactions/${real.id}`, { version: real.version, amount: '650' }).expect(200);
    b = (await u.get(`/budgets/${budget.id}`).expect(200)).body;
    expect(b.current.spent).toBe('650.00');
    await u.del(`/transactions/${real.id}`).expect(204);
    b = (await u.get(`/budgets/${budget.id}`).expect(200)).body;
    expect(b.current.spent).toBe('0.00');
  });

  it('11. monthly budgets reset at the start of each period (India time)', async () => {
    const { u, bank, food } = await setup();
    const budget = (await u.post('/budgets', { name: 'Food', categoryId: food, period: 'monthly', amount: '4000', startDate: '2026-10-01' }).expect(201)).body;
    await spend(u, bank.id, '1000', ist('2026-10-31', '23:30:00'), food); // still October in India
    await spend(u, bank.id, '250', ist('2026-11-01', '00:15:00'), food);
    const oct = (await u.get(`/budgets/${budget.id}?asOf=2026-10-31`).expect(200)).body.current;
    expect(oct).toMatchObject({ periodStart: '2026-10-01', periodEnd: '2026-11-01', spent: '1000.00', remaining: '3000.00' });
    const nov = (await u.get(`/budgets/${budget.id}?asOf=2026-11-05`).expect(200)).body.current;
    expect(nov).toMatchObject({ periodStart: '2026-11-01', periodEnd: '2026-12-01', spent: '250.00', remaining: '3750.00', carriedOver: '0.00' });
  });

  it('11b. a budget with reset day 15 runs 15th → 14th', async () => {
    const { u, bank } = await setup();
    const budget = (await u.post('/budgets', { name: 'All', period: 'monthly', amount: '20000', startDate: '2026-09-15' }).expect(201)).body;
    await spend(u, bank.id, '700', ist('2026-11-14'));
    await spend(u, bank.id, '300', ist('2026-11-15'));
    const before = (await u.get(`/budgets/${budget.id}?asOf=2026-11-14`).expect(200)).body.current;
    expect(before).toMatchObject({ periodStart: '2026-10-15', periodEnd: '2026-11-15', spent: '700.00' });
    const after = (await u.get(`/budgets/${budget.id}?asOf=2026-11-15`).expect(200)).body.current;
    expect(after).toMatchObject({ periodStart: '2026-11-15', periodEnd: '2026-12-15', spent: '300.00' });
  });

  it('carries forward unused budget when rollover is on', async () => {
    const { u, bank, food } = await setup();
    const budget = (await u.post('/budgets', { name: 'Food', categoryId: food, period: 'monthly', amount: '4000', startDate: '2026-10-01', rollover: true }).expect(201)).body;
    await spend(u, bank.id, '3000', ist('2026-10-10'), food);
    await spend(u, bank.id, '500', ist('2026-11-03'), food);
    const nov = (await u.get(`/budgets/${budget.id}?asOf=2026-11-05`).expect(200)).body.current;
    expect(nov).toMatchObject({ carriedOver: '1000.00', limit: '5000.00', spent: '500.00', remaining: '4500.00', daysLeft: 26 });
    expect(nov.dailyTarget).toBe('173.07');
  });

  it('supports weekly and custom periods', async () => {
    const { u, bank } = await setup();
    const weekly = (await u.post('/budgets', { name: 'Weekly', period: 'weekly', amount: '2000', startDate: '2026-11-02' }).expect(201)).body;
    await spend(u, bank.id, '400', ist('2026-11-04'));
    await spend(u, bank.id, '100', ist('2026-11-10'));
    expect((await u.get(`/budgets/${weekly.id}?asOf=2026-11-08`).expect(200)).body.current).toMatchObject({ periodStart: '2026-11-02', periodEnd: '2026-11-09', spent: '400.00' });
    expect((await u.get(`/budgets/${weekly.id}?asOf=2026-11-10`).expect(200)).body.current).toMatchObject({ periodStart: '2026-11-09', spent: '100.00' });
    await u.post('/budgets', { name: 'Custom', period: 'custom', amount: '500' }).expect(400);
    const custom = (await u.post('/budgets', { name: 'Custom', period: 'custom', periodDays: 10, amount: '500', startDate: '2026-11-01' }).expect(201)).body;
    expect(custom.periodDays).toBe(10);
  });

  it('prevents duplicate active budgets, allows editing and archiving', async () => {
    const { u, food } = await setup();
    const b = (await u.post('/budgets', { name: 'Food', categoryId: food, period: 'monthly', amount: '4000' }).expect(201)).body;
    const dup = await u.post('/budgets', { name: 'Food 2', categoryId: food, period: 'monthly', amount: '100' }).expect(409);
    expect(dup.body.code).toBe('budget_exists');
    const edited = (await u.patch(`/budgets/${b.id}`, { amount: '5000', alertThresholds: [80, 60] }).expect(200)).body;
    expect(edited).toMatchObject({ amount: '5000.00', alertThresholds: [60, 80] });
    await u.patch(`/budgets/${b.id}`, { alertThresholds: [0] }).expect(400);
    await u.patch(`/budgets/${b.id}`, { period: 'weekly' }).expect(400); // period is fixed
    await u.del(`/budgets/${b.id}`).expect(204);
    expect((await u.get('/budgets').expect(200)).body).toEqual([]);
    await u.post('/budgets', { name: 'Food', categoryId: food, period: 'monthly', amount: '4000' }).expect(201);
  });

  it('budgets are private to their owner', async () => {
    const { u, food } = await setup();
    const other = await registerUser(t);
    const b = (await u.post('/budgets', { name: 'Food', categoryId: food, period: 'monthly', amount: '4000' }).expect(201)).body;
    const custom = (await u.post('/categories', { name: 'Pets', kind: 'expense' }).expect(201)).body;
    await other.get(`/budgets/${b.id}`).expect(404);
    await other.patch(`/budgets/${b.id}`, { amount: '1' }).expect(404);
    await other.del(`/budgets/${b.id}`).expect(404);
    await other.post('/budgets', { name: 'Pets', categoryId: custom.id, period: 'monthly', amount: '100' }).expect(404);
    expect((await other.get('/budgets').expect(200)).body).toEqual([]);
    expect((await other.get('/budgets/alerts').expect(200)).body).toEqual([]);
  });
});

describe('Financial goals', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  async function setup() {
    const u = await registerUser(t);
    const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: '30000' }).expect(201)).body;
    return { u, bank };
  }

  it('contributions are allocations: they reduce available-to-spend, never income or expenses', async () => {
    const { u, bank } = await setup();
    const res = (await u.post('/goals', { name: 'Emergency fund', kind: 'emergency_fund', targetAmount: '100000', monthlyContribution: '5000', initialAmount: '10000', allocationMode: 'reserve' }).expect(201)).body;
    expect(res.goal).toMatchObject({ saved: '10000.00', remaining: '90000.00', progressPercent: '10.00', status: 'active', estimateBasis: 'planned_monthly_contribution' });
    expect(res.position).toMatchObject({ liquidBalance: '30000.00', allocated: '10000.00', availableToSpend: '20000.00' });

    const c = (await u.post(`/goals/${res.goal.id}/contributions`, { type: 'contribution', amount: '5000' }).expect(201)).body;
    expect(c.goal.saved).toBe('15000.00');
    expect(c.position.availableToSpend).toBe('15000.00');

    const s = (await u.get('/dashboard/summary').expect(200)).body;
    expect(s).toMatchObject({ totalBalance: '30000.00', savings: '15000.00', allocated: '15000.00', availableToSpend: '15000.00', monthIncome: '0.00', monthExpenses: '0.00' });
    expect((await u.get(`/accounts/${bank.id}`).expect(200)).body.balance).toBe('30000.00');
  });

  it('withdrawals are limited to what was saved and goals complete automatically', async () => {
    const { u } = await setup();
    const { goal } = (await u.post('/goals', { name: 'Laptop', kind: 'gadget', targetAmount: '60000', allocationMode: 'reserve' }).expect(201)).body;
    const over = await u.post(`/goals/${goal.id}/contributions`, { type: 'withdrawal', amount: '1' }).expect(422);
    expect(over.body.code).toBe('withdrawal_exceeds_saved');
    let r = (await u.post(`/goals/${goal.id}/contributions`, { type: 'contribution', amount: '60000' }).expect(201)).body;
    expect(r.goal).toMatchObject({ status: 'completed', progressPercent: '100.00', remaining: '0.00' });
    r = (await u.post(`/goals/${goal.id}/contributions`, { type: 'withdrawal', amount: '1000' }).expect(201)).body;
    expect(r.goal).toMatchObject({ status: 'active', saved: '59000.00' });
    expect(r.position.availableToSpend).toBe('-29000.00');
    expect(r.position.overcommitted).toBe(true);
    const detail = (await u.get(`/goals/${goal.id}`).expect(200)).body;
    expect(detail.contributions.map((x: any) => x.type)).toEqual(['withdrawal', 'contribution']);
  });

  it('archiving releases savings; goals in a fixed deposit do not reduce available-to-spend', async () => {
    const { u } = await setup();
    const fd = (await u.post('/accounts', { name: 'FD', type: 'fixed_deposit', openingBalance: '50000' }).expect(201)).body;
    const inFd = (await u.post('/goals', { name: 'Car', kind: 'vehicle', targetAmount: '300000', accountId: fd.id, initialAmount: '50000', allocationMode: 'reserve' }).expect(201)).body;
    expect(inFd.position).toMatchObject({ allocated: '0.00', availableToSpend: '30000.00' });
    const trip = (await u.post('/goals', { name: 'Trip', kind: 'vacation', targetAmount: '20000', initialAmount: '8000', allocationMode: 'reserve' }).expect(201)).body;
    expect(trip.position.availableToSpend).toBe('22000.00');
    const archived = (await u.post(`/goals/${trip.goal.id}/archive`).expect(200)).body;
    expect(archived.position.availableToSpend).toBe('30000.00');
    await u.post(`/goals/${trip.goal.id}/contributions`, { type: 'contribution', amount: '1' }).expect(409);
    expect((await u.get('/goals').expect(200)).body.map((g: any) => g.name)).toEqual(['Car']);
    expect((await u.get('/goals?includeArchived=true').expect(200)).body).toHaveLength(2);
  });

  it('edits, manual completion, recommendation and validation', async () => {
    const { u } = await setup();
    const { goal } = (await u.post('/goals', { name: 'Course', kind: 'education', targetAmount: '12000', targetDate: '2099-12-31', priority: 1 }).expect(201)).body;
    expect(goal.recommendedMonthly).not.toBeNull();
    expect(goal.estimatedCompletionDate).toBeNull(); // no pace yet
    const edited = (await u.patch(`/goals/${goal.id}`, { targetAmount: '15000', monthlyContribution: '5000', targetDate: null }).expect(200)).body.goal;
    expect(edited).toMatchObject({ targetAmount: '15000.00', monthlyContribution: '5000.00', targetDate: null, recommendedMonthly: null });
    expect(edited.estimatedCompletionDate).not.toBeNull();
    const done = (await u.post(`/goals/${goal.id}/complete`).expect(200)).body.goal;
    expect(done.status).toBe('completed');
    await u.post('/goals', { name: '', targetAmount: '0' }).expect(400);
    await u.post('/goals', { name: 'x', targetAmount: '10', priority: 7 }).expect(400);
  });

  it('goals are private to their owner', async () => {
    const { u, bank } = await setup();
    const other = await registerUser(t);
    const { goal } = (await u.post('/goals', { name: 'Mine', targetAmount: '1000', initialAmount: '100' }).expect(201)).body;
    await other.get(`/goals/${goal.id}`).expect(404);
    await other.post(`/goals/${goal.id}/contributions`, { type: 'withdrawal', amount: '100' }).expect(404);
    await other.post(`/goals/${goal.id}/archive`).expect(404);
    await other.post('/goals', { name: 'Steal', targetAmount: '10', accountId: bank.id }).expect(404);
    expect((await other.get('/goals').expect(200)).body).toEqual([]);
    expect((await other.get('/dashboard/summary').expect(200)).body.savings).toBe('0.00');
  });
});

describe('Month-end forecast', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('combines balances, scheduled payments, recurring items and variable spending, with assumptions', async () => {
    // Every date is derived from the explicit forecast date, never from the machine clock (KI-023).
    const AS_OF = '2026-11-08';
    const day = (offset: number) => addDays(AS_OF, offset);
    const u = await registerUser(t);
    const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: '30000', trackingStartDate: '2026-01-01' }).expect(201)).body;
    await u.post('/transactions', { type: 'income', amount: '50000', accountId: bank.id, sourceName: 'Acme', categoryId: await category(u, 'Salary'), isRecurring: true, occurredAt: ist(day(-14)) }).expect(201); // 25 Oct
    await u.post('/transactions', { type: 'expense', amount: '649', accountId: bank.id, merchant: 'Netflix', isRecurring: true, occurredAt: ist(day(-27)) }).expect(201); // 12 Oct
    for (const offset of [-3, -2, -1]) {
      await u.post('/transactions', { type: 'expense', amount: '300', accountId: bank.id, merchant: 'Cafe', occurredAt: ist(day(offset)) }).expect(201); // 5–7 Nov
    }
    await u.post('/commitments', { name: 'Rent', amount: '8000', accountId: bank.id, frequency: 'monthly', dueDate: day(12) }).expect(201); // 20 Nov
    await u.post('/commitments', { name: 'Gym', amount: '500', accountId: bank.id, frequency: 'weekly', dueDate: day(2) }).expect(201); // 10 Nov
    // The commitments existed on the forecast date, whatever day the suite actually runs.
    await setCommitmentsCreatedAt(t, u, ist(AS_OF, '08:00:00'));

    const f = (await u.get(`/forecast/month-end?asOf=${AS_OF}`).expect(200)).body;
    expect(f).toMatchObject({
      monthEnd: '2026-11-30',
      daysLeft: 22,
      startingLiquidBalance: '78451.00',
      expectedIncome: { total: '50000.00', items: [{ name: 'Acme', amount: '50000.00', date: '2026-11-25' }] },
      expectedRecurringExpenses: { total: '649.00', items: [{ name: 'Netflix', amount: '649.00', date: '2026-11-12' }] },
      variableSpending: { total: '6600.00', dailyAverage: '300.00', historyDays: 3 },
      estimatedMonthEndBalance: '111702.00',
      shortfallRisk: false,
      confidence: 'low',
    });
    expect(f.scheduledPayments.total).toBe('9500.00');
    expect(f.scheduledPayments.items.map((i: any) => `${i.name}@${i.date}`)).toEqual(['Gym@2026-11-10', 'Gym@2026-11-17', 'Rent@2026-11-20', 'Gym@2026-11-24']);
    expect(f.assumptions.length).toBeGreaterThanOrEqual(4);
    expect(f.assumptions.join(' ')).toContain('₹300.00 per day');
  });

  it('works for a brand-new user with no history', async () => {
    const u = await registerUser(t);
    const f = (await u.get('/forecast/month-end').expect(200)).body;
    expect(f).toMatchObject({ startingLiquidBalance: '0.00', estimatedMonthEndBalance: '0.00', confidence: 'low' });
    expect(f.assumptions.join(' ')).toContain('No spending history yet');
  });
});

describe('Concurrency and failure recovery', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('the same bank reference submitted concurrently is counted once', async () => {
    const u = await registerUser(t);
    const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: '1000' }).expect(201)).body;
    const body = { type: 'expense', amount: '100', accountId: bank.id, occurredAt: now(), externalReference: 'UPI-RACE-1', source: 'sms' };
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => u.post('/transactions', body)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(results.filter((r) => r.body.transaction.status === 'confirmed')).toHaveLength(1);
    expect((await u.get(`/accounts/${bank.id}`).expect(200)).body.balance).toBe('900.00');
  });

  it('a reservation can only be settled once under concurrent payments', async () => {
    const u = await registerUser(t);
    const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: '10000' }).expect(201)).body;
    const { reservation } = (await u.post('/reservations', { name: 'Rent', accountId: bank.id, targetAmount: '8000', dueDate: '2026-12-01' }).expect(201)).body;
    const tx = await Promise.all([1, 2].map((i) => u.post('/transactions', { type: 'expense', amount: '8000', accountId: bank.id, occurredAt: now(), merchant: `Landlord ${i}` }).expect(201)));
    const settles = await Promise.all(tx.map((r) => u.post(`/reservations/${reservation.id}/settle`, { transactionId: r.body.transaction.id })));
    expect(settles.map((s) => s.status).sort()).toEqual([200, 409]);
  });

  it('concurrent goal withdrawals cannot take out more than was saved', async () => {
    const u = await registerUser(t);
    const { goal } = (await u.post('/goals', { name: 'Fund', targetAmount: '5000', initialAmount: '1000' }).expect(201)).body;
    const results = await Promise.all([1, 2].map(() => u.post(`/goals/${goal.id}/contributions`, { type: 'withdrawal', amount: '700' })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect((await u.get(`/goals/${goal.id}`).expect(200)).body.saved).toBe('300.00');
  });

  it('a rejected reservation payment rolls back completely', async () => {
    const u = await registerUser(t);
    const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: '10000' }).expect(201)).body;
    const { reservation } = (await u.post('/reservations', { name: 'Electricity', accountId: bank.id, targetAmount: '1000', dueDate: '2026-12-05' }).expect(201)).body;
    const res = await u.post('/transactions', { type: 'expense', amount: '1200', accountId: bank.id, occurredAt: now(), reservationId: reservation.id }).expect(409);
    expect(res.body.code).toBe('reservation_amount_mismatch');
    // No expense, no ledger entry, reservation still held.
    expect((await u.get('/transactions').expect(200)).body.total).toBe(0);
    const s = (await u.get('/dashboard/summary').expect(200)).body;
    expect(s).toMatchObject({ liquidBalance: '10000.00', reserved: '1000.00', availableToSpend: '9000.00' });
    const audit = await t.db.selectFrom('audit_logs').select('id').where('entity_type', '=', 'transaction').where('actor_id', 'in', t.db.selectFrom('users').select('id').where('email', '=', u.email)).execute();
    expect(audit).toHaveLength(0);
  });
});
