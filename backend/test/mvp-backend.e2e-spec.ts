import { Logger } from '@nestjs/common';
import { MailerService } from '../src/auth/mailer.service';
import { addMonths, today } from '../src/common/dates';
import { loadConfig } from '../src/config/env';
import { category, createTestApp, registerUser, TestApp } from './helpers';

const ist = (date: string, time = '12:00:00') => `${date}T${time}+05:30`;

describe('Monthly report', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('summarises a month from confirmed income and expenses, excluding transfers and card bill payments', async () => {
    const u = await registerUser(t);
    const since = { trackingStartDate: '2026-01-01' };
    const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: '10000', ...since }).expect(201)).body;
    const card = (await u.post('/accounts', { name: 'Card', type: 'credit_card', ...since }).expect(201)).body;
    const food = await category(u, 'Food');
    const rent = await category(u, 'Rent');
    // October (previous month)
    await u.post('/transactions', { type: 'income', amount: '40000', accountId: bank.id, categoryId: await category(u, 'Salary'), occurredAt: ist('2026-10-01') }).expect(201);
    await u.post('/transactions', { type: 'expense', amount: '1000', accountId: bank.id, categoryId: food, occurredAt: ist('2026-10-10') }).expect(201);
    // September 2026 must not leak into October or November
    await u.post('/transactions', { type: 'expense', amount: '777', accountId: bank.id, categoryId: food, occurredAt: ist('2026-09-30', '23:59:00') }).expect(201);
    // November
    await u.post('/transactions', { type: 'income', amount: '50000', accountId: bank.id, categoryId: await category(u, 'Salary'), occurredAt: ist('2026-11-01', '00:10:00') }).expect(201);
    await u.post('/transactions', { type: 'expense', amount: '12000', accountId: bank.id, categoryId: rent, occurredAt: ist('2026-11-02') }).expect(201); // essential (Rent)
    await u.post('/transactions', { type: 'expense', amount: '3000', accountId: card.id, categoryId: food, merchant: 'Zomato', isPlanned: false, occurredAt: ist('2026-11-03') }).expect(201);
    await u.post('/transactions', { type: 'transfer', amount: '3000', accountId: bank.id, destinationAccountId: card.id, occurredAt: ist('2026-11-04') }).expect(201); // card bill
    await u.post('/transactions', { type: 'expense', amount: '500', accountId: bank.id, occurredAt: ist('2026-11-05'), status: 'failed', source: 'sms' }).expect(201); // not counted

    const r = (await u.get('/reports/monthly?month=2026-11').expect(200)).body;
    expect(r).toMatchObject({
      month: '2026-11',
      periodStart: '2026-11-01',
      periodEnd: '2026-12-01',
      income: '50000.00',
      expenses: '15000.00',
      net: '35000.00',
      savingsRatePercent: '70.00',
      expenseCount: 2,
      essential: '12000.00',
      nonEssential: '3000.00',
      planned: '0.00',
      unplanned: '15000.00',
      previousMonth: { month: '2026-10', income: '40000.00', expenses: '1000.00', incomeChange: '10000.00', expensesChange: '14000.00' },
    });
    expect(r.expensesByCategory).toEqual([
      { categoryId: rent, name: 'Rent', total: '12000.00', sharePercent: '80.00', count: 1 },
      { categoryId: food, name: 'Food', total: '3000.00', sharePercent: '20.00', count: 1 },
    ]);
    expect(r.incomeByCategory).toEqual([expect.objectContaining({ name: 'Salary', total: '50000.00', sharePercent: '100.00' })]);
    expect(r.largestExpenses.map((x: any) => [x.label, x.amount])).toEqual([
      ['Rent', '12000.00'],
      ['Zomato', '3000.00'],
    ]);
    const oct = (await u.get('/reports/monthly?month=2026-10').expect(200)).body;
    expect(oct.expenses).toBe('1000.00');
  });

  it('handles an empty month, rejects future months and keeps reports private', async () => {
    const u = await registerUser(t);
    const empty = (await u.get('/reports/monthly').expect(200)).body;
    expect(empty).toMatchObject({ month: today().slice(0, 7), income: '0.00', expenses: '0.00', savingsRatePercent: null, expensesByCategory: [], largestExpenses: [] });
    const future = addMonths(`${today().slice(0, 7)}-01`, 1, 1).slice(0, 7);
    expect((await u.get(`/reports/monthly?month=${future}`).expect(422)).body.code).toBe('report_future_month');
    await u.get('/reports/monthly?month=2026-13').expect(400);
    // Another user's spending never appears in this user's report.
    const other = await registerUser(t);
    const acct = (await other.post('/accounts', { name: 'B', type: 'savings', openingBalance: '100' }).expect(201)).body;
    await other.post('/transactions', { type: 'expense', amount: '50', accountId: acct.id, occurredAt: new Date().toISOString() }).expect(201);
    expect((await u.get('/reports/monthly').expect(200)).body.expenses).toBe('0.00');
  });
});

describe('Health and production configuration', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('exposes liveness and database readiness without authentication', async () => {
    expect((await t.http().get('/api/v1/health').expect(200)).body).toEqual({ status: 'ok' });
    expect((await t.http().get('/api/v1/health/ready').expect(200)).body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('refuses to start in production with missing or unsafe settings, listing every problem', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_ACCESS_SECRET[\s\S]*DATABASE_URL[\s\S]*CORS_ORIGINS[\s\S]*APP_WEB_URL/);
    const base = { NODE_ENV: 'production', JWT_ACCESS_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@h/db?sslmode=require', APP_WEB_URL: 'https://pfm.vercel.app' };
    expect(() => loadConfig({ ...base, CORS_ORIGINS: '*' })).toThrow(/no wildcards/);
    expect(() => loadConfig({ ...base, CORS_ORIGINS: 'http://pfm.vercel.app' })).toThrow(/https/);
    expect(() => loadConfig({ ...base, CORS_ORIGINS: 'https://pfm.vercel.app', SMTP_HOST: 'smtp.gmail.com' })).toThrow(/SMTP_FROM/);
    const ok = loadConfig({ ...base, CORS_ORIGINS: 'https://pfm.vercel.app', PORT: '10000' });
    expect(ok).toMatchObject({ port: 10000, corsOrigins: ['https://pfm.vercel.app'], apiDocs: false, trustProxy: 1 });
    expect(loadConfig({ ...base, CORS_ORIGINS: 'https://pfm.vercel.app', ENABLE_API_DOCS: 'true' }).apiDocs).toBe(true);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('in production without SMTP, never logs email bodies (one-time links)', async () => {
    const config = loadConfig({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@h/db', APP_WEB_URL: 'https://pfm.vercel.app', CORS_ORIGINS: 'https://pfm.vercel.app' });
    const mailer = new MailerService(config);
    const logs: string[] = [];
    const spies = (['log', 'warn', 'error'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation(((msg: any) => void logs.push(String(msg))) as any));
    try {
      await mailer.send({ to: 'asha@example.com', subject: 'Reset your password', text: 'https://pfm.vercel.app/reset-password?token=SECRET-TOKEN' });
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    expect(logs.join('\n')).toContain('was not sent');
    expect(logs.join('\n')).not.toContain('SECRET-TOKEN');
    expect(logs.join('\n')).not.toContain('asha@example.com');
  });
});
