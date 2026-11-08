import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Executor } from '../database/schema';
import { DomainError } from './errors';

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Key-order-independent JSON for request fingerprints. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .filter((k) => (value as any)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((value as any)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateIdempotencyKey(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!KEY_PATTERN.test(key)) {
    throw new DomainError('invalid_idempotency_key', 'Idempotency-Key must be 8–128 characters: letters, digits, . _ : -', HttpStatus.BAD_REQUEST);
  }
  return key;
}

/**
 * Client-generated idempotency keys (D-017). Used for mutations a client may replay, e.g. from an
 * offline queue. The key is claimed inside the same DB transaction as the mutation, so either both
 * the mutation and its stored response commit, or neither does. A concurrent duplicate blocks on
 * the primary key until the first commits, then replays the stored response.
 */
@Injectable()
export class IdempotencyService {
  async run<T>(
    trx: Executor,
    ownerId: string,
    key: string | undefined,
    scope: string,
    request: unknown,
    fn: () => Promise<T>,
  ): Promise<{ replayed: boolean; body: T }> {
    if (!key) return { replayed: false, body: await fn() };
    const requestHash = createHash('sha256').update(`${scope}|${stable(request)}`).digest('hex');
    const claimed = await trx
      .insertInto('idempotency_keys')
      .values({ owner_id: ownerId, key, scope, request_hash: requestHash, response_status: 0, response_body: JSON.stringify(null) })
      .onConflict((oc) => oc.columns(['owner_id', 'key']).doNothing())
      .returning('key')
      .executeTakeFirst();
    if (!claimed) {
      const existing = await trx.selectFrom('idempotency_keys').selectAll().where('owner_id', '=', ownerId).where('key', '=', key).executeTakeFirstOrThrow();
      if (existing.scope !== scope || existing.request_hash !== requestHash) {
        throw new DomainError('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      if (existing.response_status === 0) {
        throw new DomainError('idempotency_in_progress', 'The original request is still being processed. Retry shortly.', HttpStatus.CONFLICT);
      }
      return { replayed: true, body: existing.response_body as T };
    }
    const body = await fn();
    await trx
      .updateTable('idempotency_keys')
      .set({ response_status: 200, response_body: JSON.stringify(body) })
      .where('owner_id', '=', ownerId)
      .where('key', '=', key)
      .execute();
    return { replayed: false, body };
  }
}
