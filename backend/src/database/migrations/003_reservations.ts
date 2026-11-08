// Phase 3: fixed commitments and virtual money reservations.
// Reservations never write to the ledger: they only reduce available-to-spend.
export const name = '003_reservations';

export const up = /* sql */ `
CREATE TABLE financial_commitments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              uuid NOT NULL REFERENCES users(id),
  organization_id       uuid NOT NULL REFERENCES organizations(id),
  name                  text NOT NULL,
  amount                numeric(19,2) NOT NULL CHECK (amount > 0),
  currency              char(3) NOT NULL DEFAULT 'INR',
  account_id            uuid NOT NULL REFERENCES bank_accounts(id),
  category_id           uuid REFERENCES transaction_categories(id),
  frequency             text NOT NULL CHECK (frequency IN ('once', 'weekly', 'monthly', 'yearly', 'custom_days')),
  interval_count        integer NOT NULL DEFAULT 1 CHECK (interval_count > 0),
  next_due_date         date NOT NULL,
  anchor_day            smallint NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  reminder_days_before  integer NOT NULL DEFAULT 3 CHECK (reminder_days_before >= 0),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'completed')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_commitments_owner_idx ON financial_commitments (owner_id, status, next_due_date);

CREATE TABLE money_reservations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES users(id),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  commitment_id    uuid REFERENCES financial_commitments(id),
  account_id       uuid NOT NULL REFERENCES bank_accounts(id),
  name             text NOT NULL,
  target_amount    numeric(19,2) NOT NULL CHECK (target_amount > 0),
  reserved_amount  numeric(19,2) NOT NULL CHECK (reserved_amount >= 0),
  due_date         date NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconciled', 'released', 'cancelled')),
  transaction_id   uuid REFERENCES transactions(id),
  settled_amount   numeric(19,2),
  variance         numeric(19,2),
  closed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved_amount <= target_amount)
);
CREATE INDEX money_reservations_owner_idx ON money_reservations (owner_id, status, due_date);
-- One open reservation per commitment occurrence; a transaction settles at most one reservation.
CREATE UNIQUE INDEX money_reservations_commitment_due_unique
  ON money_reservations (commitment_id, due_date) WHERE commitment_id IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX money_reservations_transaction_unique
  ON money_reservations (transaction_id) WHERE transaction_id IS NOT NULL;
`;
