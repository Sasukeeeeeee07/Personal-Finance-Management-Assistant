import { HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { DomainError } from '../common/errors';
import { APP_CONFIG, AppConfig } from '../config/env';
import { DATABASE } from '../database/database.module';
import type { DB, Executor } from '../database/schema';
import { ROLES } from '../rbac/permissions';
import { RbacService } from '../rbac/rbac.service';
import { AuditService } from '../audit/audit.service';
import { MailerService } from './mailer.service';
import type { AccessTokenPayload } from './auth.guard';

// Argon2id parameters (OWASP baseline: m=19 MiB, t=2, p=1).
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const newOpaqueToken = () => randomBytes(32).toString('base64url');

@Injectable()
export class AuthService {
  private dummyHash: Promise<string>;
  private google?: OAuth2Client;

  constructor(
    @Inject(DATABASE) private readonly db: DB,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
    private readonly rbac: RbacService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {
    // Used to keep login timing similar whether or not the email exists.
    this.dummyHash = argonHash('timing-equaliser-password', ARGON_OPTS);
    if (config.googleClientIds.length) this.google = new OAuth2Client();
  }

  async register(input: { email: string; password: string; fullName: string }, client: ClientInfo): Promise<TokenPair> {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await argonHash(input.password, ARGON_OPTS);
    const userId = await this.db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('users').select('id').where((eb) => eb(eb.fn('lower', ['email']), '=', email)).where('deleted_at', 'is', null).executeTakeFirst();
      if (exists) throw new DomainError('email_taken', 'An account with this email already exists. Sign in instead.', HttpStatus.CONFLICT);
      return this.createUserWithPersonalOrg(trx, { email, fullName: input.fullName.trim(), passwordHash });
    });
    await this.sendVerificationEmail(userId, email);
    return this.issueSession(userId, client);
  }

  async login(input: { email: string; password: string }, client: ClientInfo): Promise<TokenPair> {
    const email = input.email.trim().toLowerCase();
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'password_hash', 'status'])
      .where((eb) => eb(eb.fn('lower', ['email']), '=', email))
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    const ok = user?.password_hash
      ? await argonVerify(user.password_hash, input.password)
      : (await argonVerify(await this.dummyHash, input.password), false);
    if (!user || !ok) throw new UnauthorizedException('Email or password is incorrect.');
    if (user.status !== 'active') throw new UnauthorizedException('This account is suspended. Contact support.');
    return this.issueSession(user.id, client);
  }

  async loginWithGoogle(idToken: string, client: ClientInfo): Promise<TokenPair> {
    if (!this.google) throw new DomainError('google_not_configured', 'Google Sign-In is not available right now.', HttpStatus.SERVICE_UNAVAILABLE);
    let payload;
    try {
      const ticket = await this.google.verifyIdToken({ idToken, audience: this.config.googleClientIds });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Google sign-in could not be verified. Try again.');
    }
    if (!payload?.sub || !payload.email || !payload.email_verified) {
      throw new UnauthorizedException('Your Google account email must be verified.');
    }
    const email = payload.email.toLowerCase();
    const userId = await this.db.transaction().execute(async (trx) => {
      const bySub = await trx.selectFrom('users').select('id').where('google_sub', '=', payload.sub).where('deleted_at', 'is', null).executeTakeFirst();
      if (bySub) return bySub.id;
      const byEmail = await trx.selectFrom('users').select('id').where((eb) => eb(eb.fn('lower', ['email']), '=', email)).where('deleted_at', 'is', null).executeTakeFirst();
      if (byEmail) {
        // Google verified ownership of this email, so linking is safe.
        await trx.updateTable('users').set({ google_sub: payload.sub, email_verified_at: new Date(), updated_at: new Date() }).where('id', '=', byEmail.id).execute();
        return byEmail.id;
      }
      const id = await this.createUserWithPersonalOrg(trx, { email, fullName: payload.name ?? email.split('@')[0], passwordHash: null, googleSub: payload.sub });
      await trx.updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', id).execute();
      return id;
    });
    return this.issueSession(userId, client);
  }

  /**
   * Refresh-token rotation. Each refresh token is single-use; presenting an already-rotated token
   * means it was stolen or replayed, so the whole token family is revoked.
   */
  async refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    const tokenHash = sha256(refreshToken);
    const result = await this.db.transaction().execute(async (trx): Promise<TokenPair | 'reused'> => {
      const session = await trx.selectFrom('sessions').selectAll().where('token_hash', '=', tokenHash).forUpdate().executeTakeFirst();
      if (!session) throw new UnauthorizedException('Your session has ended. Sign in again.');
      if (session.rotated_at || session.revoked_at) {
        // Commit the revocation before rejecting: throwing here would roll it back.
        await trx.updateTable('sessions').set({ revoked_at: new Date() }).where('family_id', '=', session.family_id).where('revoked_at', 'is', null).execute();
        await this.audit.record(trx, { actorId: session.user_id, entityType: 'session', entityId: session.family_id, action: 'refresh_token_reuse_detected' });
        return 'reused';
      }
      if (new Date(session.expires_at).getTime() < Date.now()) throw new UnauthorizedException('Your session has expired. Sign in again.');
      const user = await trx.selectFrom('users').select(['status', 'deleted_at']).where('id', '=', session.user_id).executeTakeFirstOrThrow();
      if (user.status !== 'active' || user.deleted_at) throw new UnauthorizedException('Your session has ended. Sign in again.');
      await trx.updateTable('sessions').set({ rotated_at: new Date(), revoked_at: new Date() }).where('id', '=', session.id).execute();
      return this.issueSession(session.user_id, client, session.family_id, trx);
    });
    if (result === 'reused') throw new UnauthorizedException('Your session has ended. Sign in again.');
    return result;
  }

  async logout(userId: string, sessionId: string, allDevices = false): Promise<void> {
    const session = await this.db.selectFrom('sessions').select('family_id').where('id', '=', sessionId).where('user_id', '=', userId).executeTakeFirst();
    let q = this.db.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', userId).where('revoked_at', 'is', null);
    if (!allDevices) q = q.where('family_id', '=', session?.family_id ?? '00000000-0000-0000-0000-000000000000');
    await q.execute();
  }

  async listSessions(userId: string) {
    return this.db
      .selectFrom('sessions')
      .select(['family_id as id', 'user_agent', 'ip_address', 'created_at', 'expires_at'])
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .execute();
  }

  async revokeSession(userId: string, familyId: string): Promise<void> {
    await this.db.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', userId).where('family_id', '=', familyId).where('revoked_at', 'is', null).execute();
  }

  async me(userId: string, organizationId: string, permissions: string[]) {
    const user = await this.db
      .selectFrom('users')
      .leftJoin('roles', 'roles.id', 'users.platform_role_id')
      .select(['users.id', 'users.email', 'users.full_name', 'users.email_verified_at', 'roles.key as platform_role'])
      .where('users.id', '=', userId)
      .executeTakeFirstOrThrow();
    const memberships = await this.db
      .selectFrom('organization_members as m')
      .innerJoin('organizations as o', 'o.id', 'm.organization_id')
      .innerJoin('roles as r', 'r.id', 'm.role_id')
      .select(['o.id', 'o.name', 'o.type', 'o.plan_code', 'r.key as role'])
      .where('m.user_id', '=', userId)
      .execute();
    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      emailVerified: !!user.email_verified_at,
      platformRole: user.platform_role,
      activeOrganizationId: organizationId,
      organizations: memberships.map((m) => ({ id: m.id, name: m.name, type: m.type, plan: m.plan_code, role: m.role })),
      permissions,
    };
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.db.selectFrom('users').select(['email', 'email_verified_at']).where('id', '=', userId).executeTakeFirstOrThrow();
    if (user.email_verified_at) return;
    await this.sendVerificationEmail(userId, user.email);
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.consumeToken(token, 'email_verification');
    await this.db.updateTable('users').set({ email_verified_at: new Date(), updated_at: new Date() }).where('id', '=', userId).execute();
  }

  /** Always succeeds so the response does not reveal whether an email is registered. */
  async forgotPassword(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.db.selectFrom('users').select(['id', 'email']).where((eb) => eb(eb.fn('lower', ['email']), '=', email)).where('deleted_at', 'is', null).executeTakeFirst();
    if (!user) return;
    const token = await this.createToken(this.db, user.id, 'password_reset', RESET_TOKEN_TTL_MS);
    await this.mailer.send({
      to: user.email,
      subject: 'Reset your password',
      text: `Reset your password within 1 hour: ${this.config.appWebUrl}/reset-password?token=${token}\nIf you didn't ask for this, ignore this email.`,
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const passwordHash = await argonHash(password, ARGON_OPTS);
    await this.db.transaction().execute(async (trx) => {
      const userId = await this.consumeToken(token, 'password_reset', trx);
      await trx.updateTable('users').set({ password_hash: passwordHash, updated_at: new Date() }).where('id', '=', userId).execute();
      // A password reset signs out every device.
      await trx.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', userId).where('revoked_at', 'is', null).execute();
      await this.audit.record(trx, { actorId: userId, entityType: 'user', entityId: userId, action: 'password_reset' });
    });
  }

  // --- internals -------------------------------------------------------------------------------

  private async createUserWithPersonalOrg(
    trx: Executor,
    u: { email: string; fullName: string; passwordHash: string | null; googleSub?: string },
  ): Promise<string> {
    const org = await trx.insertInto('organizations').values({ name: `${u.fullName}'s finances`, type: 'personal', deleted_at: null }).returning('id').executeTakeFirstOrThrow();
    const user = await trx
      .insertInto('users')
      .values({
        email: u.email,
        password_hash: u.passwordHash,
        full_name: u.fullName,
        google_sub: u.googleSub ?? null,
        platform_role_id: null,
        default_organization_id: org.id,
        email_verified_at: null,
        deleted_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // The owner of a personal workspace administers it.
    await trx.insertInto('organization_members').values({ organization_id: org.id, user_id: user.id, role_id: await this.rbac.roleId(ROLES.ORG_ADMIN, trx) }).execute();
    await this.audit.record(trx, { organizationId: org.id, actorId: user.id, entityType: 'user', entityId: user.id, action: 'registered' });
    return user.id;
  }

  private async issueSession(userId: string, client: ClientInfo, familyId: string = randomUUID(), db: Executor = this.db): Promise<TokenPair> {
    const user = await db.selectFrom('users').select('default_organization_id').where('id', '=', userId).executeTakeFirstOrThrow();
    const refreshToken = newOpaqueToken();
    const session = await db
      .insertInto('sessions')
      .values({
        user_id: userId,
        family_id: familyId,
        token_hash: sha256(refreshToken),
        expires_at: new Date(Date.now() + this.config.refreshTokenTtlDays * 86_400_000),
        user_agent: client.userAgent?.slice(0, 300) ?? null,
        ip_address: client.ip ?? null,
        rotated_at: null,
        revoked_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const payload: AccessTokenPayload = { sub: userId, org: user.default_organization_id!, sid: session.id };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.config.jwtAccessTtlSeconds });
    return { accessToken, refreshToken, accessTokenExpiresIn: this.config.jwtAccessTtlSeconds };
  }

  private async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const token = await this.createToken(this.db, userId, 'email_verification', EMAIL_TOKEN_TTL_MS);
    await this.mailer.send({
      to: email,
      subject: 'Verify your email',
      text: `Confirm your email address: ${this.config.appWebUrl}/verify-email?token=${token}`,
    });
  }

  private async createToken(db: Executor, userId: string, purpose: 'email_verification' | 'password_reset', ttlMs: number): Promise<string> {
    const token = newOpaqueToken();
    await db.insertInto('auth_tokens').values({ user_id: userId, purpose, token_hash: sha256(token), expires_at: new Date(Date.now() + ttlMs), used_at: null }).execute();
    return token;
  }

  private async consumeToken(token: string, purpose: 'email_verification' | 'password_reset', db: Executor = this.db): Promise<string> {
    const row = await db
      .updateTable('auth_tokens')
      .set({ used_at: new Date() })
      .where('token_hash', '=', sha256(token))
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .returning('user_id')
      .executeTakeFirst();
    if (!row) throw new DomainError('invalid_token', 'This link is invalid or has expired. Request a new one.', HttpStatus.BAD_REQUEST);
    return row.user_id;
  }
}
