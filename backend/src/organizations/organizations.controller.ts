import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Injectable, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { DomainError, notFound } from '../common/errors';
import { DATABASE } from '../database/database.module';
import type { DB } from '../database/schema';
import { AuditService } from '../audit/audit.service';
import { PERMISSIONS, ROLES } from '../rbac/permissions';
import { RbacService } from '../rbac/rbac.service';

export class AddMemberDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty({ enum: [ROLES.ORG_ADMIN, ROLES.STANDARD_USER] }) @IsIn([ROLES.ORG_ADMIN, ROLES.STANDARD_USER]) role: string;
}

/**
 * Organization administration. Deliberately exposes membership only — an admin never gains access
 * to members' accounts, balances or transactions through these endpoints.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DATABASE) private readonly db: DB,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  members(user: AuthUser) {
    return this.db
      .selectFrom('organization_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .innerJoin('roles as r', 'r.id', 'm.role_id')
      .select(['u.id as userId', 'u.full_name as fullName', 'u.email', 'r.key as role', 'm.created_at as joinedAt'])
      .where('m.organization_id', '=', user.organizationId)
      .orderBy('m.created_at')
      .execute();
  }

  async addMember(user: AuthUser, dto: AddMemberDto) {
    const target = await this.db.selectFrom('users').select('id').where((eb) => eb(eb.fn('lower', ['email']), '=', dto.email.toLowerCase())).where('deleted_at', 'is', null).executeTakeFirst();
    if (!target) throw new DomainError('user_not_found', 'No account uses this email yet. Ask them to sign up first.', HttpStatus.NOT_FOUND);
    const roleId = await this.rbac.roleId(dto.role);
    await this.db
      .insertInto('organization_members')
      .values({ organization_id: user.organizationId, user_id: target.id, role_id: roleId })
      .onConflict((oc) => oc.columns(['organization_id', 'user_id']).doUpdateSet({ role_id: roleId }))
      .execute();
    await this.audit.record(this.db, { organizationId: user.organizationId, actorId: user.userId, entityType: 'organization_member', entityId: target.id, action: 'upserted', after: { role: dto.role } });
  }

  async removeMember(user: AuthUser, memberUserId: string) {
    if (memberUserId === user.userId) throw new DomainError('cannot_remove_self', 'You cannot remove yourself from your own organization.', HttpStatus.CONFLICT);
    const r = await this.db.deleteFrom('organization_members').where('organization_id', '=', user.organizationId).where('user_id', '=', memberUserId).executeTakeFirst();
    if (!r.numDeletedRows) throw notFound('Member');
    await this.audit.record(this.db, { organizationId: user.organizationId, actorId: user.userId, entityType: 'organization_member', entityId: memberUserId, action: 'removed' });
  }
}

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization/members')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get() @RequirePermissions(PERMISSIONS.ORG_MEMBERS_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.orgs.members(user);
  }

  @Post() @HttpCode(204) @RequirePermissions(PERMISSIONS.ORG_MEMBERS_MANAGE)
  add(@CurrentUser() user: AuthUser, @Body() dto: AddMemberDto) {
    return this.orgs.addMember(user, dto);
  }

  @Delete(':userId') @HttpCode(204) @RequirePermissions(PERMISSIONS.ORG_MEMBERS_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.orgs.removeMember(user, userId);
  }
}
