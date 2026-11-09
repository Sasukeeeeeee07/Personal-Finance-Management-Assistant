import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';
import { join } from 'path';
import { category, createTestApp, now, registerUser, TestApp, TestUser } from './helpers';

/**
 * Response contract (review gate, Flutter step 2). Real responses must match the FROZEN OpenAPI
 * schemas exactly: every documented field present, no undocumented fields, money as 2-decimal
 * strings, dates as YYYY-MM-DD, timestamps as ISO 8601.
 */
const FROZEN = JSON.parse(readFileSync(join(__dirname, '..', '..', 'docs', 'api', 'openapi-v1.json'), 'utf8'));

/** OpenAPI 3.0 → JSON Schema: `nullable` becomes a null branch; objects get additionalProperties: false. */
function strict(schema: any): any {
  if (Array.isArray(schema)) return schema.map(strict);
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) if (k !== 'nullable' && k !== 'example') out[k] = strict(v);
  if (out.type === 'object' && out.properties && out.additionalProperties === undefined) out.additionalProperties = false;
  if (schema.nullable) return { anyOf: [{ type: 'null' }, out] };
  return out;
}

function responseSchema(path: string, method = 'get') {
  const op = FROZEN.paths[path]?.[method];
  const schema = op?.responses?.['200']?.content?.['application/json']?.schema;
  if (!schema) throw new Error(`No documented 200 response for ${method.toUpperCase()} ${path}`);
  return schema;
}

describe('Response contract (frozen OpenAPI)', () => {
  let t: TestApp;
  let u: TestUser;
  let ajv: Ajv;
  const validators = new Map<string, ValidateFunction>();
  const ids: Record<string, string> = {};

  const validate = (path: string, body: unknown) => {
    if (!validators.has(path)) {
      validators.set(path, ajv.compile({ ...strict(responseSchema(path)), components: strict(FROZEN.components) }));
    }
    const fn = validators.get(path)!;
    const ok = fn(body);
    if (!ok) throw new Error(`${path} does not match its schema:\n${JSON.stringify(fn.errors, null, 2)}`);
  };

  beforeAll(async () => {
    t = await createTestApp();
    ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    // Populate every field family the dashboard shows.
    u = await registerUser(t, 'Contract User');
    const since = { trackingStartDate: '2026-01-01' };
    const bank = (await u.post('/accounts', { name: 'Bank', type: 'savings', openingBalance: '30000', institutionName: 'HDFC', accountMask: '4821', ...since }).expect(201)).body;
    const card = (await u.post('/accounts', { name: 'Card', type: 'credit_card', openingBalance: '1200', creditLimit: '50000', ...since }).expect(201)).body;
    await u.post('/accounts', { name: 'FD', type: 'fixed_deposit', openingBalance: '100000', openingDate: '2024-04-01', ...since }).expect(201);
    const food = await category(u, 'Food');
    await u.post('/budgets', { name: 'Everything', period: 'monthly', amount: '20000' }).expect(201);
    await u.post('/budgets', { name: 'Food', categoryId: food, period: 'monthly', amount: '4000' }).expect(201);
    await u.post('/commitments', { name: 'Rent', amount: '8000', accountId: bank.id, frequency: 'monthly', dueDate: '2026-11-20' }).expect(201);
    await u.post('/goals', { name: 'Trip', targetAmount: '20000', initialAmount: '2000', allocationMode: 'reserve' }).expect(201);
    await u.post('/transactions', { type: 'income', amount: '50000', accountId: bank.id, categoryId: await category(u, 'Salary'), sourceName: 'Acme', isRecurring: true, occurredAt: '2026-10-25T10:00:00+05:30' }).expect(201);
    const exp = (await u.post('/transactions', { type: 'expense', amount: '2500', accountId: bank.id, categoryId: food, merchant: 'Zomato', occurredAt: now() }).expect(201)).body.transaction;
    await u.post('/transactions', { type: 'expense', amount: '999', accountId: card.id, merchant: 'Amazon', occurredAt: now() }).expect(201);
    await u.post('/transactions', { type: 'transfer', amount: '500', accountId: bank.id, destinationAccountId: card.id, occurredAt: now() }).expect(201);
    ids.expense = exp.id;
    ids.bank = bank.id;
  });
  afterAll(async () => t.close());

  it('documents a 200 response schema for every endpoint the dashboard consumes', () => {
    for (const p of ['/api/v1/auth/me', '/api/v1/accounts', '/api/v1/accounts/{id}', '/api/v1/categories', '/api/v1/budgets', '/api/v1/budgets/{id}', '/api/v1/dashboard/summary', '/api/v1/forecast/month-end', '/api/v1/transactions', '/api/v1/transactions/{id}']) {
      expect(() => responseSchema(p)).not.toThrow();
    }
  });

  it('GET /dashboard/summary', async () => {
    const body = (await u.get('/dashboard/summary').expect(200)).body;
    validate('/api/v1/dashboard/summary', body);
    expect(body.monthlyBudget).not.toBeNull();
    expect(body.upcomingPayments.length).toBeGreaterThan(0);
    // netPosition = all accounts: 30000 + 50000 − 2500 − 500 (bank) + 100000 (FD) − (1200 + 999 − 500) (card)
    expect(body.netPosition).toBe('175301.00');
  });

  it('GET /dashboard/summary for a brand-new user (nulls and empty lists)', async () => {
    const fresh = await registerUser(t);
    validate('/api/v1/dashboard/summary', (await fresh.get('/dashboard/summary').expect(200)).body);
    validate('/api/v1/forecast/month-end', (await fresh.get('/forecast/month-end').expect(200)).body);
    validate('/api/v1/transactions', (await fresh.get('/transactions').expect(200)).body);
    validate('/api/v1/budgets', (await fresh.get('/budgets').expect(200)).body);
  });

  it('GET /forecast/month-end, including the comparison with available money now', async () => {
    const body = (await u.get('/forecast/month-end').expect(200)).body;
    validate('/api/v1/forecast/month-end', body);
    const summary = (await u.get('/dashboard/summary').expect(200)).body;
    expect(body.availableNow).toBe(summary.availableToSpend);
  });

  it('GET /budgets and /budgets/{id}', async () => {
    const list = (await u.get('/budgets').expect(200)).body;
    validate('/api/v1/budgets', list);
    validate('/api/v1/budgets/{id}', (await u.get(`/budgets/${list[0].id}`).expect(200)).body);
  });

  it('GET /transactions and /transactions/{id} (with insight and budget)', async () => {
    validate('/api/v1/transactions', (await u.get('/transactions?status=confirmed&pageSize=5').expect(200)).body);
    const detail = (await u.get(`/transactions/${ids.expense}`).expect(200)).body;
    validate('/api/v1/transactions/{id}', detail);
    expect(detail.insight.budget).not.toBeNull();
  });

  it('GET /accounts, /accounts/{id}, /categories and /auth/me', async () => {
    validate('/api/v1/accounts', (await u.get('/accounts').expect(200)).body);
    validate('/api/v1/accounts/{id}', (await u.get(`/accounts/${ids.bank}`).expect(200)).body);
    validate('/api/v1/categories', (await u.get('/categories').expect(200)).body);
    validate('/api/v1/auth/me', (await u.get('/auth/me').expect(200)).body);
  });

  it('Flutter test fixtures still match the contract', () => {
    const dir = join(__dirname, '..', '..', 'mobile', 'test', 'fixtures');
    const map: Record<string, string> = {
      'me.json': '/api/v1/auth/me',
      'dashboard_summary.json': '/api/v1/dashboard/summary',
      'dashboard_summary_empty.json': '/api/v1/dashboard/summary',
      'budgets.json': '/api/v1/budgets',
      'forecast.json': '/api/v1/forecast/month-end',
      'forecast_empty.json': '/api/v1/forecast/month-end',
      'transactions_recent.json': '/api/v1/transactions',
      'transaction_detail.json': '/api/v1/transactions/{id}',
      'accounts.json': '/api/v1/accounts',
      'categories.json': '/api/v1/categories',
    };
    for (const [file, path] of Object.entries(map)) validate(path, JSON.parse(readFileSync(join(dir, file), 'utf8')));
  });

  it('GET /commitments, /reservations, /goals, /goals/{id} and /reports/monthly (MVP screens)', async () => {
    validate('/api/v1/commitments', (await u.get('/commitments').expect(200)).body);
    const reservations = (await u.get('/reservations').expect(200)).body;
    expect(reservations.length).toBeGreaterThan(0);
    validate('/api/v1/reservations', reservations);
    const goals = (await u.get('/goals').expect(200)).body;
    validate('/api/v1/goals', goals);
    await u.post(`/goals/${goals[0].id}/contributions`, { type: 'withdrawal', amount: '100' }).expect(201);
    validate('/api/v1/goals/{id}', (await u.get(`/goals/${goals[0].id}`).expect(200)).body);
    validate('/api/v1/reports/monthly', (await u.get('/reports/monthly').expect(200)).body);
    validate('/api/v1/reports/monthly', (await u.get('/reports/monthly?month=2026-10').expect(200)).body);
    const fresh = await registerUser(t);
    validate('/api/v1/reports/monthly', (await fresh.get('/reports/monthly').expect(200)).body);
    validate('/api/v1/goals', (await fresh.get('/goals').expect(200)).body);
  });

  it('the validator really rejects drift', () => {
    const fn = ajv.compile({ ...strict(responseSchema('/api/v1/accounts/{id}')), components: strict(FROZEN.components) });
    const good = { id: '00000000-0000-4000-8000-000000000000', name: 'a', type: 'savings', institutionName: null, accountMask: null, currency: 'INR', isLiquid: true, isLiability: false, creditLimit: null, openingDate: null, trackingStartDate: '2026-01-01', archived: false, balance: '1.00', outstanding: null, availableCredit: null };
    expect(fn(good)).toBe(true);
    expect(fn({ ...good, balance: 1 })).toBe(false); // money as a number
    expect(fn({ ...good, balance: '1.5' })).toBe(false); // not 2 decimals
    expect(fn({ ...good, surprise: true })).toBe(false); // undocumented field
    const { name, ...missing } = good;
    expect(fn(missing)).toBe(false); // documented field missing
  });
});
