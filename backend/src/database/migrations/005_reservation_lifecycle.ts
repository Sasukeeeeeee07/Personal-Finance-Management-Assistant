// Review gate B1: explicit occurrence identity for recurring reservations, an auditable
// payment-to-reservation link, and successor tracking so a reversed payment restores the exact
// pre-payment state instead of leaving two open reservations for one obligation.
export const name = '005_reservation_lifecycle';

export const up = /* sql */ `
ALTER TABLE money_reservations ADD COLUMN occurrence_date date;
UPDATE money_reservations SET occurrence_date = due_date;
ALTER TABLE money_reservations ALTER COLUMN occurrence_date SET NOT NULL;
ALTER TABLE money_reservations ADD COLUMN created_from_reservation_id uuid REFERENCES money_reservations(id);
ALTER TABLE money_reservations ADD COLUMN close_reason text;
DROP INDEX money_reservations_commitment_due_unique;
-- One live reservation per occurrence of a commitment (cancelled rows are history).
CREATE UNIQUE INDEX money_reservations_occurrence_unique
  ON money_reservations (commitment_id, occurrence_date)
  WHERE commitment_id IS NOT NULL AND status <> 'cancelled';
-- A settlement spawns at most one live successor.
CREATE UNIQUE INDEX money_reservations_successor_unique
  ON money_reservations (created_from_reservation_id)
  WHERE created_from_reservation_id IS NOT NULL AND status <> 'cancelled';

-- Every payment ↔ reservation link, including reversed ones.
CREATE TABLE reservation_settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES users(id),
  reservation_id   uuid NOT NULL REFERENCES money_reservations(id),
  transaction_id   uuid NOT NULL REFERENCES transactions(id),
  amount           numeric(19,2) NOT NULL CHECK (amount > 0),
  variance         numeric(19,2) NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  reversal_reason  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  reversed_at      timestamptz,
  CHECK ((status = 'reversed') = (reversed_at IS NOT NULL))
);
CREATE UNIQUE INDEX reservation_settlements_active_reservation ON reservation_settlements (reservation_id) WHERE status = 'active';
CREATE UNIQUE INDEX reservation_settlements_active_transaction ON reservation_settlements (transaction_id) WHERE status = 'active';
CREATE INDEX reservation_settlements_owner_idx ON reservation_settlements (owner_id, created_at DESC);

INSERT INTO reservation_settlements (owner_id, reservation_id, transaction_id, amount, variance, created_at)
SELECT owner_id, id, transaction_id, settled_amount, COALESCE(variance, 0), COALESCE(closed_at, now())
FROM money_reservations WHERE status = 'reconciled' AND transaction_id IS NOT NULL;
`;

export const down = /* sql */ `
DROP TABLE reservation_settlements;
DROP INDEX money_reservations_successor_unique;
DROP INDEX money_reservations_occurrence_unique;
CREATE UNIQUE INDEX money_reservations_commitment_due_unique
  ON money_reservations (commitment_id, due_date) WHERE commitment_id IS NOT NULL AND status <> 'cancelled';
ALTER TABLE money_reservations DROP COLUMN close_reason;
ALTER TABLE money_reservations DROP COLUMN created_from_reservation_id;
ALTER TABLE money_reservations DROP COLUMN occurrence_date;
`;
