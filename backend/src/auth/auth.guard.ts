import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthUser, IS_PUBLIC, REQUIRED_PERMISSIONS } from '../common/auth-context';
import { DATABASE } from '../database/database.module';
import type { DB } from '../database/schema';
import type { PermissionKey } from '../rbac/permissions';
import { RbacService } from '../rbac/rbac.service';

export interface AccessTokenPayload {
  sub: string;
  org: string;
  sid: string;
}

/**
 * Global guard: every route requires a valid access token unless marked @Public().
 * Also rejects tokens whose session was revoked (logout, password reset, token reuse) and
 * enforces @RequirePermissions(...).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly rbac: RbacService,
    @Inject(DATABASE) private readonly db: DB,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue.');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }

    const session = await this.db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .select(['sessions.revoked_at', 'users.status', 'users.deleted_at'])
      .where('sessions.id', '=', payload.sid)
      .where('sessions.user_id', '=', payload.sub)
      .executeTakeFirst();
    if (!session || session.revoked_at || session.status !== 'active' || session.deleted_at) {
      throw new UnauthorizedException('Your session has ended. Sign in again.');
    }

    const permissions = await this.rbac.permissionsFor(payload.sub, payload.org);
    const user: AuthUser = { userId: payload.sub, organizationId: payload.org, sessionId: payload.sid, permissions };
    req.user = user;

    const required = this.reflector.getAllAndOverride<PermissionKey[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    if (required.some((p) => !permissions.includes(p))) {
      throw new ForbiddenException("You don't have permission to do this.");
    }
    return true;
  }
}
