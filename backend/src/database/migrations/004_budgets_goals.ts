// Phase 3: budgets (limits on expense transactions) and savings goals (allocations).
export const name = '004_budgets_goals';

export const up = /* sql */ `
CREATE TABLE budgets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES users(id),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  name              text NOT NULL,
  scope             text NOT NULL CHECK (scope IN ('overall', 'category')),
  category_id       uuid REFERENCES transaction_categories(id),
  period            text NOT NULL CHECK (period IN ('monthly', 'weekly', 'custom')),
  period_days       integer CHECK (period_days IS NULL OR period_days BETWEEN 1 AND 366),
  amount            numeric(19,2) NOT NULL CHECK (amount > 0),
  currency          char(3) NOT NULL DEFAULT 'INR',
  start_date        date NOT NULL,
  rollover          boolean NOT NULL DEFAULT false,
  alert_thresholds  integer[] NOT NULL DEFAULT '{50,75,90,100}',
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'category') = (category_id IS NOT NULL)),
  CHECK ((period = 'custom') = (period_days IS NOT NULL))
);
CREATE INDEX budgets_owner_idx ON budgets (owner_id, status);
-- One active budget per (scope target, period type).
CREATE UNIQUE INDEX budgets_active_unique
  ON budgets (owner_id, COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid), period)
  WHERE status = 'active';

-- Each threshold fires at most once per budget period.
CREATE TABLE budget_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES users(id),
  budget_id     uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('threshold', 'exceeded')),
  threshold     integer NOT NULL CHECK (threshold BETWEEN 1 AND 100),
  spent         numeric(19,2) NOT NULL,
  limit_amount  numeric(19,2) NOT NULL,
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, period_start, kind, threshold)
);
CREATE INDEX budget_alerts_owner_idx ON budget_alerts (owner_id, created_at DESC);

CREATE TABLE financial_goals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              uuid NOT NULL REFERENCES users(id),
  organization_id       uuid NOT NULL REFERENCES organizations(id),
  name                  text NOT NULL,
  kind                  text NOT NULL DEFAULT 'custom' CHECK (kind IN ('emergency_fund', 'gadget', 'vacation', 'education', 'vehicle', 'savings', 'custom')),
  target_amount         numeric(19,2) NOT NULL CHECK (target_amount > 0),
  currency              char(3) NOT NULL DEFAULT 'INR',
  target_date           date,
  monthly_contribution  numeric(19,2) CHECK (monthly_contribution IS NULL OR monthly_contribution > 0),
  priority              smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  account_id            uuid REFERENCES bank_accounts(id),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_goals_owner_idx ON financial_goals (owner_id, status);

-- Positive = money set aside for the goal, negative = withdrawn from it. Never touches the ledger.
CREATE TABLE goal_contributions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES users(id),
  goal_id         uuid NOT NULL REFERENCES financial_goals(id),
  amount          numeric(19,2) NOT NULL CHECK (amount <> 0),
  contributed_on  date NOT NULL,
  note            text,
  is_opening      boolean NOT NULL DEFAULT false,
  transaction_id  uuid REFERENCES transactions(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goal_contributions_goal_idx ON goal_contributions (goal_id, contributed_on);
`;

export const down = /* sql */ `
DROP TABLE goal_contributions;
DROP TABLE financial_goals;
DROP TABLE budget_alerts;
DROP TABLE budgets;
`;
