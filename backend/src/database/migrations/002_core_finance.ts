// Phase 2: accounts, categories, transactions and the ledger.
// Money is NUMERIC(19,2). Balances are derived: opening_balance + SUM(ledger_entries.amount).
export const name = '002_core_finance';

export const up = /* sql */ `
CREATE TABLE bank_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES users(id),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  name             text NOT NULL,
  type             text NOT NULL CHECK (type IN ('savings', 'current', 'cash', 'upi_bank', 'credit_card', 'wallet', 'fixed_deposit', 'other')),
  institution_name text,
  account_mask     text CHECK (account_mask IS NULL OR account_mask ~ '^[0-9]{2,4}$'),
  currency         char(3) NOT NULL DEFAULT 'INR',
  opening_balance  numeric(19,2) NOT NULL DEFAULT 0,
  opening_date     date NOT NULL DEFAULT CURRENT_DATE,
  is_liquid        boolean NOT NULL,
  is_liability     boolean NOT NULL,
  credit_limit     numeric(19,2),
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX bank_accounts_owner_idx ON bank_accounts (owner_id) WHERE deleted_at IS NULL;

-- owner_id NULL = system category visible to everyone.
CREATE TABLE transaction_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid REFERENCES users(id),
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('income', 'expense')),
  is_essential  boolean NOT NULL DEFAULT false,
  icon          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX transaction_categories_unique
  ON transaction_categories (COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, lower(name))
  WHERE deleted_at IS NULL;

CREATE TABLE transactions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                uuid NOT NULL REFERENCES users(id),
  organization_id         uuid NOT NULL REFERENCES organizations(id),
  type                    text NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  status                  text NOT NULL CHECK (status IN ('confirmed', 'needs_review', 'duplicate', 'ignored', 'failed')),
  amount                  numeric(19,2) NOT NULL CHECK (amount > 0),
  currency                char(3) NOT NULL DEFAULT 'INR',
  account_id              uuid NOT NULL REFERENCES bank_accounts(id),
  destination_account_id  uuid REFERENCES bank_accounts(id),
  category_id             uuid REFERENCES transaction_categories(id),
  occurred_at             timestamptz NOT NULL,
  merchant                text,
  source_name             text,
  description             text,
  notes                   text,
  payment_method          text,
  external_reference      text,
  source                  text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'sms', 'notification', 'statement_import', 'account_aggregator')),
  is_planned              boolean,
  is_essential            boolean,
  is_recurring            boolean NOT NULL DEFAULT false,
  duplicate_of_id         uuid REFERENCES transactions(id),
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  CHECK ((type = 'transfer') = (destination_account_id IS NOT NULL)),
  CHECK (destination_account_id IS NULL OR destination_account_id <> account_id),
  CHECK (type <> 'transfer' OR category_id IS NULL)
);
CREATE INDEX transactions_owner_date_idx ON transactions (owner_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX transactions_account_idx ON transactions (account_id) WHERE deleted_at IS NULL;
CREATE INDEX transactions_category_idx ON transactions (owner_id, category_id) WHERE deleted_at IS NULL;
-- The same bank reference on the same account can only be counted once.
CREATE UNIQUE INDEX transactions_external_ref_unique
  ON transactions (owner_id, account_id, external_reference)
  WHERE external_reference IS NOT NULL AND deleted_at IS NULL AND status IN ('confirmed', 'needs_review');

-- Append-only ledger. Only confirmed, non-deleted transactions have entries.
CREATE TABLE ledger_entries (
  id              bigserial PRIMARY KEY,
  owner_id        uuid NOT NULL REFERENCES users(id),
  transaction_id  uuid NOT NULL REFERENCES transactions(id),
  account_id      uuid NOT NULL REFERENCES bank_accounts(id),
  amount          numeric(19,2) NOT NULL CHECK (amount <> 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id);
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (transaction_id);
`;
