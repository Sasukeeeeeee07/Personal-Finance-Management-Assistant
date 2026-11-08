/**
 * DEVELOPMENT ONLY. Creates a clearly labelled demo account with realistic activity through the
 * public API, for screenshots and for generating Flutter test fixtures from real responses.
 *
 *   npx ts-node scripts/demo-data.ts http://localhost:4000/api/v1 [--fixtures ../mobile/test/fixtures]
 *
 * Refuses to run against anything except localhost. Never use against a shared or production API.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const base = process.argv[2] ?? 'http://localhost:4000/api/v1';
const fixturesDir = process.argv.includes('--fixtures') ? process.argv[process.argv.indexOf('--fixtures') + 1] : null;
const host = new URL(base).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`Refusing to seed demo data on ${host}. This script is for a local development API only.`);
  process.exit(1);
}

let token = '';
async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : (undefined as T);
}

/** Calendar date in India time, offset by whole days from today. */
function day(offset: number): string {
  const ist = new Date(Date.now() + 5.5 * 3600_000 + offset * 86_400_000);
  return ist.toISOString().slice(0, 10);
}
const at = (offset: number, time = '12:00:00') => `${day(offset)}T${time}+05:30`;
const monthStart = () => `${day(0).slice(0, 7)}-01`;

async function main() {
  const email = `demo-${Date.now()}@example.test`;
  // DEMO_PASSWORD lets a developer sign in to the demo account in the app (local API only).
  const password = process.env.DEMO_PASSWORD ?? `Demo-${Math.random().toString(36).slice(2)}-1`;
  const reg = await call('POST', '/auth/register', { fullName: 'Asha Verma', email, password });
  token = reg.accessToken;

  const since = { trackingStartDate: day(-120) };
  const bank = await call('POST', '/accounts', { name: 'HDFC Savings', type: 'savings', institutionName: 'HDFC Bank', accountMask: '4821', openingBalance: '42500', ...since });
  const wallet = await call('POST', '/accounts', { name: 'Paytm Wallet', type: 'wallet', openingBalance: '1200', ...since });
  const card = await call('POST', '/accounts', { name: 'ICICI Amazon Pay', type: 'credit_card', accountMask: '9012', creditLimit: '80000', openingBalance: '0', ...since });
  await call('POST', '/accounts', { name: 'SBI Fixed Deposit', type: 'fixed_deposit', openingBalance: '150000', openingDate: '2024-04-01', ...since });

  const cats: any[] = await call('GET', '/categories');
  const cat = (name: string) => cats.find((c) => c.name === name).id;

  // Last month: salary (recurring) and a recurring subscription.
  await call('POST', '/transactions', { type: 'income', amount: '68000', accountId: bank.id, categoryId: cat('Salary'), sourceName: 'Acme Technologies', isRecurring: true, occurredAt: at(-34, '09:30:00') });
  await call('POST', '/transactions', { type: 'expense', amount: '649', accountId: card.id, categoryId: cat('Subscriptions'), merchant: 'Netflix', isRecurring: true, occurredAt: at(-30) });
  for (const [amt, d, m] of [['420', -40, 'Swiggy'], ['1850', -38, 'BigBasket'], ['380', -25, 'Zomato'], ['2200', -20, 'DMart']] as const) {
    await call('POST', '/transactions', { type: 'expense', amount: amt, accountId: bank.id, categoryId: cat(m === 'BigBasket' || m === 'DMart' ? 'Groceries' : 'Food'), merchant: m, occurredAt: at(d) });
  }

  // This month.
  await call('POST', '/transactions', { type: 'income', amount: '68000', accountId: bank.id, categoryId: cat('Salary'), sourceName: 'Acme Technologies', isRecurring: true, occurredAt: `${monthStart()}T09:30:00+05:30` });
  await call('POST', '/budgets', { name: 'All spending', period: 'monthly', amount: '40000' });
  await call('POST', '/budgets', { name: 'Food', categoryId: cat('Food'), period: 'monthly', amount: '6000' });
  await call('POST', '/budgets', { name: 'Shopping', categoryId: cat('Shopping'), period: 'monthly', amount: '3000' });
  await call('POST', '/budgets', { name: 'Transport', categoryId: cat('Transportation'), period: 'monthly', amount: '2500' });

  const today = Number(day(0).slice(8, 10));
  const thisMonth = (n: number) => -Math.min(n, today - 1); // keep within this month
  const spend = [
    ['650', thisMonth(6), 'Food', 'Zomato', bank.id],
    ['1240', thisMonth(5), 'Food', 'Barbeque Nation', card.id],
    ['3480', thisMonth(4), 'Shopping', 'Myntra', card.id],
    ['890', thisMonth(3), 'Food', 'Swiggy', wallet.id],
    ['310', thisMonth(2), 'Transportation', 'Uber', wallet.id],
    ['1640', thisMonth(1), 'Food', 'Third Wave Coffee', bank.id],
    ['250', 0, 'Food', 'Zomato', bank.id],
  ] as const;
  for (const [amt, d, c, m, acct] of spend) {
    await call('POST', '/transactions', { type: 'expense', amount: amt, accountId: acct, categoryId: cat(c), merchant: m, occurredAt: at(d, '13:15:00') });
  }
  await call('POST', '/transactions', { type: 'transfer', amount: '2000', accountId: bank.id, destinationAccountId: wallet.id, occurredAt: at(thisMonth(2), '10:00:00') });

  // Money Lock: rent soon, electricity due, internet overdue, card bill reserved partially.
  await call('POST', '/commitments', { name: 'Rent', amount: '18000', accountId: bank.id, frequency: 'monthly', dueDate: day(12), categoryId: cat('Rent') });
  await call('POST', '/commitments', { name: 'Electricity', amount: '1400', accountId: bank.id, frequency: 'monthly', dueDate: day(4), categoryId: cat('Electricity') });
  await call('POST', '/commitments', { name: 'Airtel Fiber', amount: '999', accountId: bank.id, frequency: 'monthly', dueDate: day(-2), categoryId: cat('Internet') });
  await call('POST', '/commitments', { name: 'Car EMI', amount: '9500', accountId: bank.id, frequency: 'monthly', dueDate: day(18), categoryId: cat('EMI'), reserveAmount: '5000' });

  // Savings goals: one reserved (reduces available-to-spend), one track-only.
  await call('POST', '/goals', { name: 'Emergency fund', kind: 'emergency_fund', targetAmount: '150000', monthlyContribution: '8000', initialAmount: '24000', allocationMode: 'reserve', priority: 1 });
  await call('POST', '/goals', { name: 'Goa trip', kind: 'vacation', targetAmount: '35000', targetDate: day(150), initialAmount: '6000' });

  const summary = await call('GET', '/dashboard/summary');
  console.log(`Demo account ready: ${email}`);
  console.log(`Available to spend ${summary.availableToSpend} · reserved ${summary.reserved} · card dues ${summary.creditCardOutstanding}`);

  if (fixturesDir) {
    mkdirSync(fixturesDir, { recursive: true });
    const recent = await call('GET', '/transactions?status=confirmed&pageSize=5&sort=occurredAt:desc');
    const expense = recent.items.find((t: any) => t.type === 'expense' && t.categoryId);
    const dump: Record<string, unknown> = {
      'me.json': await call('GET', '/auth/me'),
      'dashboard_summary.json': summary,
      'budgets.json': await call('GET', '/budgets'),
      'forecast.json': await call('GET', '/forecast/month-end'),
      'transactions_recent.json': recent,
      'transaction_detail.json': await call('GET', `/transactions/${expense.id}`),
      'accounts.json': await call('GET', '/accounts?includeArchived=true'),
      'categories.json': cats,
    };
    // An empty account, for empty states.
    token = (await call('POST', '/auth/register', { fullName: 'New User', email: `empty-${Date.now()}@example.test`, password: `Demo-${Math.random().toString(36).slice(2)}-1` })).accessToken;
    dump['dashboard_summary_empty.json'] = await call('GET', '/dashboard/summary');
    dump['forecast_empty.json'] = await call('GET', '/forecast/month-end');
    for (const [file, body] of Object.entries(dump)) writeFileSync(join(fixturesDir, file), JSON.stringify(body, null, 2) + '\n');
    console.log(`Wrote ${Object.keys(dump).length} fixtures to ${fixturesDir}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
