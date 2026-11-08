import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import type { DB, Executor } from '../database/schema';
import type { PermissionKey } from './permissions';

@Injectable()
export class RbacService {
  constructor(@Inject(DATABASE) private readonly db: DB) {}

  /** Union of the user's platform-role permissions and their role in the given organization. */
  async permissionsFor(userId: string, organizationId: string, db: Executor = this.db): Promise<PermissionKey[]> {
    const rows = await db
      .selectFrom('permissions as p')
      .innerJoin('role_permissions as rp', 'rp.permission_id', 'p.id')
      .where((eb) =>
        eb.or([
          eb('rp.role_id', 'in', eb.selectFrom('users').select('platform_role_id').where('id', '=', userId).where('platform_role_id', 'is not', null)),
          eb(
            'rp.role_id',
            'in',
            eb.selectFrom('organization_members').select('role_id').where('user_id', '=', userId).where('organization_id', '=', organizationId),
          ),
        ]),
      )
      .select('p.key')
      .distinct()
      .execute();
    return rows.map((r) => r.key as PermissionKey);
  }

  async roleId(key: string, db: Executor = this.db): Promise<string> {
    const row = await db.selectFrom('roles').select('id').where('key', '=', key).executeTakeFirstOrThrow();
    return row.id;
  }
}
