import { createTestApp, now, registerUser, TestApp } from './helpers';

const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)![1];

describe('Authentication', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('registers, signs in and returns the profile', async () => {
    const u = await registerUser(t, 'Asha Verma');
    const me = (await u.get('/auth/me').expect(200)).body;
    expect(me).toMatchObject({ email: u.email, fullName: 'Asha Verma', emailVerified: false });
    expect(me.organizations[0].role).toBe('org_admin');
    expect(me.permissions).toEqual(expect.arrayContaining(['finance.own.read', 'finance.own.write']));

    await t.http().post('/api/v1/auth/login').send({ email: u.email.toUpperCase(), password: u.password }).expect(200);
    const bad = await t.http().post('/api/v1/auth/login').send({ email: u.email, password: 'wrong-password-1' }).expect(401);
    expect(bad.body.message).toBe('Email or password is incorrect.');
    await t.http().post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password-1' }).expect(401);
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const u = await registerUser(t);
    await t.http().post('/api/v1/auth/register').send({ email: u.email, password: 'another-pass-2', fullName: 'X' }).expect(409);
    const weak = await t.http().post('/api/v1/auth/register').send({ email: 'weak@example.com', password: 'short', fullName: 'X' }).expect(400);
    expect(weak.body.fields.password).toBeDefined();
  });

  it('requires a token for protected routes', async () => {
    await t.http().get('/api/v1/accounts').expect(401);
    await t.http().get('/api/v1/accounts').set('Authorization', 'Bearer not-a-jwt').expect(401);
    await t.http().get('/api/v1/health').expect(200);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const u = await registerUser(t);
    const r1 = (await t.http().post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(200)).body;
    expect(r1.refreshToken).not.toBe(u.refreshToken);
    // Replaying the old token is treated as theft: the whole chain is revoked.
    await t.http().post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    await t.http().post('/api/v1/auth/refresh').send({ refreshToken: r1.refreshToken }).expect(401);
    await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${r1.accessToken}`).expect(401);
  });

  it('logout ends the session immediately', async () => {
    const u = await registerUser(t);
    await u.post('/auth/logout').expect(204);
    await u.get('/auth/me').expect(401);
    await t.http().post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
  });

  it('verifies email with a single-use link', async () => {
    const u = await registerUser(t);
    const mail = t.mailer.outbox.filter((m) => m.to === u.email && m.subject === 'Verify your email').pop()!;
    const token = tokenFrom(mail.text);
    await t.http().post('/api/v1/auth/verify-email').send({ token }).expect(204);
    await t.http().post('/api/v1/auth/verify-email').send({ token }).expect(400);
    expect((await u.get('/auth/me').expect(200)).body.emailVerified).toBe(true);
  });

  it('resets a forgotten password and signs out other sessions', async () => {
    const u = await registerUser(t);
    const unknown = await t.http().post('/api/v1/auth/forgot-password').send({ email: 'missing@example.com' }).expect(202);
    const known = await t.http().post('/api/v1/auth/forgot-password').send({ email: u.email }).expect(202);
    expect(known.body).toEqual(unknown.body); // no account enumeration
    const mail = t.mailer.outbox.filter((m) => m.to === u.email && m.subject === 'Reset your password').pop()!;
    await t.http().post('/api/v1/auth/reset-password').send({ token: tokenFrom(mail.text), password: 'brand-new-pass-9' }).expect(204);
    await u.get('/auth/me').expect(401);
    await t.http().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(401);
    await t.http().post('/api/v1/auth/login').send({ email: u.email, password: 'brand-new-pass-9' }).expect(200);
  });

  it('never stores plain-text passwords or refresh tokens', async () => {
    const u = await registerUser(t);
    const row = await t.db.selectFrom('users').select('password_hash').where('email', '=', u.email).executeTakeFirstOrThrow();
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    const s = await t.db.selectFrom('sessions').select('token_hash').where('token_hash', '=', u.refreshToken).executeTakeFirst();
    expect(s).toBeUndefined();
  });
});

describe('RBAC and tenant isolation', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('12. users can never access another user’s financial records', async () => {
    const alice = await registerUser(t, 'Alice');
    const bob = await registerUser(t, 'Bob');
    const acct = (await alice.post('/accounts', { name: 'Alice Savings', type: 'savings', openingBalance: '1000' }).expect(201)).body;
    const txn = (await alice.post('/transactions', { type: 'expense', amount: '10', accountId: acct.id, occurredAt: now() }).expect(201)).body.transaction;
    const res = (await alice.post('/reservations', { name: 'Rent', accountId: acct.id, targetAmount: '500', dueDate: '2026-12-01' }).expect(201)).body.reservation;
    const bobAcct = (await bob.post('/accounts', { name: 'Bob Savings', type: 'savings', openingBalance: '0' }).expect(201)).body;

    await bob.get(`/accounts/${acct.id}`).expect(404);
    await bob.get(`/transactions/${txn.id}`).expect(404);
    await bob.get(`/transactions/${txn.id}/history`).expect(404);
    await bob.patch(`/transactions/${txn.id}`, { version: 1, amount: '1' }).expect(404);
    await bob.del(`/transactions/${txn.id}`).expect(404);
    await bob.post('/transactions', { type: 'expense', amount: '10', accountId: acct.id, occurredAt: now() }).expect(404);
    await bob.post('/transactions', { type: 'transfer', amount: '10', accountId: bobAcct.id, destinationAccountId: acct.id, occurredAt: now() }).expect(404);
    await bob.post(`/reservations/${res.id}/release`).expect(404);
    await bob.post(`/accounts/${acct.id}/reconcile`, { actualBalance: '0' }).expect(404);
    expect((await bob.get('/accounts').expect(200)).body.map((a: any) => a.id)).toEqual([bobAcct.id]);
    expect((await bob.get('/transactions').expect(200)).body.total).toBe(0);
    expect((await bob.get('/reservations').expect(200)).body).toEqual([]);
    expect((await alice.get(`/accounts/${acct.id}`).expect(200)).body.balance).toBe('990.00');
  });

  it('organization admins manage members but cannot see their finances', async () => {
    const admin = await registerUser(t, 'Admin');
    const member = await registerUser(t, 'Member');
    await member.post('/accounts', { name: 'Private', type: 'savings', openingBalance: '5000' }).expect(201);
    await admin.post('/organization/members', { email: member.email, role: 'standard_user' }).expect(204);
    const members = (await admin.get('/organization/members').expect(200)).body;
    expect(members.map((m: any) => m.email)).toEqual(expect.arrayContaining([admin.email, member.email]));
    expect(JSON.stringify(members)).not.toContain('5000');
    // The admin's own finance endpoints only ever return the admin's own data.
    expect((await admin.get('/accounts').expect(200)).body).toEqual([]);
    expect((await admin.get('/dashboard/summary').expect(200)).body.totalBalance).toBe('0.00');
  });

  it('enforces permissions on admin endpoints', async () => {
    const u = await registerUser(t);
    // Downgrade the user to standard_user in their own organization.
    const user = await t.db.selectFrom('users').select(['id', 'default_organization_id']).where('email', '=', u.email).executeTakeFirstOrThrow();
    const role = await t.db.selectFrom('roles').select('id').where('key', '=', 'standard_user').executeTakeFirstOrThrow();
    await t.db.updateTable('organization_members').set({ role_id: role.id }).where('user_id', '=', user.id).execute();
    await u.get('/organization/members').expect(403);
    await u.post('/organization/members', { email: 'x@example.com', role: 'org_admin' }).expect(403);
    await u.get('/accounts').expect(200);
  });
});
