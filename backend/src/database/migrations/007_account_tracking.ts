// Review gate B4: an account's opening balance applies from its tracking start date.
// Manual transactions before that date are rejected. Explicit historical statement imports are
// stored with is_historical = true: they feed analytics but never the ledger, because the opening
// balance already includes them.
export const name = '007_account_tracking';

export const up = /* sql */ `
ALTER TABLE bank_accounts ADD COLUMN tracking_start_date date;
UPDATE bank_accounts SET tracking_start_date = opening_date;
ALTER TABLE bank_accounts ALTER COLUMN tracking_start_date SET NOT NULL;
ALTER TABLE bank_accounts ALTER COLUMN opening_date DROP NOT NULL;
ALTER TABLE bank_accounts ALTER COLUMN opening_date DROP DEFAULT;
ALTER TABLE transactions ADD COLUMN is_historical boolean NOT NULL DEFAULT false;
ALTER TABLE transactions ADD CONSTRAINT transactions_historical_source CHECK (NOT is_historical OR source IN ('statement_import', 'account_aggregator'));
`;

export const down = /* sql */ `
ALTER TABLE transactions DROP CONSTRAINT transactions_historical_source;
ALTER TABLE transactions DROP COLUMN is_historical;
UPDATE bank_accounts SET opening_date = tracking_start_date WHERE opening_date IS NULL;
ALTER TABLE bank_accounts ALTER COLUMN opening_date SET DEFAULT CURRENT_DATE;
ALTER TABLE bank_accounts ALTER COLUMN opening_date SET NOT NULL;
ALTER TABLE bank_accounts DROP COLUMN tracking_start_date;
`;
