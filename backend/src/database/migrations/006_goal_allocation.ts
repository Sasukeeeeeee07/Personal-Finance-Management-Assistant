// Review gate B2: goal allocation becomes opt-in. Progress (contributions), virtual allocation
// (allocation_mode = 'reserve') and actual bank movement (linked transfer) are separate concepts.
export const name = '006_goal_allocation';

export const up = /* sql */ `
ALTER TABLE financial_goals ADD COLUMN allocation_mode text NOT NULL DEFAULT 'track_only'
  CHECK (allocation_mode IN ('track_only', 'reserve'));
-- Goals created before this migration already reduced available-to-spend; keep that behaviour for them.
UPDATE financial_goals SET allocation_mode = 'reserve';

ALTER TABLE goal_contributions ADD COLUMN reverses_contribution_id uuid REFERENCES goal_contributions(id);
-- A contribution can be reversed once; a transfer can back at most one contribution.
CREATE UNIQUE INDEX goal_contributions_reversal_unique ON goal_contributions (reverses_contribution_id) WHERE reverses_contribution_id IS NOT NULL;
CREATE UNIQUE INDEX goal_contributions_transaction_unique ON goal_contributions (transaction_id) WHERE transaction_id IS NOT NULL;
`;

export const down = /* sql */ `
DROP INDEX goal_contributions_transaction_unique;
DROP INDEX goal_contributions_reversal_unique;
ALTER TABLE goal_contributions DROP COLUMN reverses_contribution_id;
ALTER TABLE financial_goals DROP COLUMN allocation_mode;
`;
