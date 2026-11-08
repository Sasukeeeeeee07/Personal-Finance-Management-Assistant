// Review gate E: client-generated Idempotency-Key for mutations replayed from an offline queue.
export const name = '008_idempotency';

export const up = /* sql */ `
CREATE TABLE idempotency_keys (
  owner_id         uuid NOT NULL REFERENCES users(id),
  key              text NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  scope            text NOT NULL,
  request_hash     text NOT NULL,
  response_status  integer NOT NULL,
  response_body    jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
`;

export const down = /* sql */ `
DROP TABLE idempotency_keys;
`;
