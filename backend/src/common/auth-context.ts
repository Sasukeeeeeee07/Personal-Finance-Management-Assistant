import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../rbac/permissions';

/** The authenticated caller. All financial queries are scoped by userId (owner). */
export interface AuthUser {
  userId: string;
  organizationId: string;
  sessionId: string;
  permissions: PermissionKey[];
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSIONS = 'requiredPermissions';
export const RequirePermissions = (...permissions: PermissionKey[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
