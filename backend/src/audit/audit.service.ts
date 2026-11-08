import { Injectable } from '@nestjs/common';
import type { Executor } from '../database/schema';

@Injectable()
export class AuditService {
  /** Must be called with the same executor as the change so the audit row commits atomically with it. */
  async record(
    db: Executor,
    entry: { organizationId?: string | null; actorId?: string | null; entityType: string; entityId: string; action: string; before?: unknown; after?: unknown },
  ): Promise<void> {
    await db
      .insertInto('audit_logs')
      .values({
        organization_id: entry.organizationId ?? null,
        actor_id: entry.actorId ?? null,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        action: entry.action,
        before: entry.before === undefined ? null : JSON.stringify(entry.before),
        after: entry.after === undefined ? null : JSON.stringify(entry.after),
      })
      .execute();
  }
}
