import type { ColumnType, Generated, Kysely, Transaction } from 'kysely';

// NUMERIC columns are read as strings and written as strings to avoid floating point.
type Money = ColumnType<string, string | undefined, string>;
type MoneyNullable = ColumnType<string | null, string | null | undefined, string | null>;
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type TimestampNullable = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type DateOnly = ColumnType<string, string, string>;

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  type: Generated<'personal' | 'business'>;
  plan_code: Generated<string>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  deleted_at: TimestampNullable;
}

export interface RolesTable {
  id: Generated<string>;
  key: string;
  name: string;
  scope: 'platform' | 'organization';
  is_system: Generated<boolean>;
  created_at: GeneratedTimestamp;
}

export interface PermissionsTable {
  id: Generated<string>;
  key: string;
  description: string;
}

export interface RolePermissionsTable {
  role_id: string;
  permission_id: string;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string | null;
  full_name: string;
  email_verified_at: TimestampNullable;
  google_sub: string | null;
  platform_role_id: string | null;
  default_organization_id: string | null;
  status: Generated<'active' | 'suspended'>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  deleted_at: TimestampNullable;
}

export interface OrganizationMembersTable {
  id: Generated<string>;
  organization_id: string;
  user_id: string;
  role_id: string;
  created_at: GeneratedTimestamp;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Timestamp;
  rotated_at: TimestampNullable;
  revoked_at: TimestampNullable;
  user_agent: string | null;
  ip_address: string | null;
  created_at: GeneratedTimestamp;
}

export interface AuthTokensTable {
  id: Generated<string>;
  user_id: string;
  purpose: 'email_verification' | 'password_reset';
  token_hash: string;
  expires_at: Timestamp;
  used_at: TimestampNullable;
  created_at: GeneratedTimestamp;
}

export interface AuditLogsTable {
  id: Generated<string>;
  organization_id: string | null;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  before: unknown | null;
  after: unknown | null;
  created_at: GeneratedTimestamp;
}

export type AccountType =
  | 'savings' | 'current' | 'cash' | 'upi_bank' | 'credit_card' | 'wallet' | 'fixed_deposit' | 'other';

export interface BankAccountsTable {
  id: Generated<string>;
  owner_id: string;
  organization_id: string;
  name: string;
  type: AccountType;
  institution_name: string | null;
  account_mask: string | null;
  currency: Generated<string>;
  opening_balance: Money;
  opening_date: ColumnType<string, string | undefined, string>;
  is_liquid: boolean;
  is_liability: boolean;
  credit_limit: MoneyNullable;
  archived_at: TimestampNullable;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  deleted_at: TimestampNullable;
}

export interface TransactionCategoriesTable {
  id: Generated<string>;
  owner_id: string | null;
  name: string;
  kind: 'income' | 'expense';
  is_essential: Generated<boolean>;
  icon: string | null;
  created_at: GeneratedTimestamp;
  deleted_at: TimestampNullable;
}

export type TransactionType = 'income' | 'expense' | 'transfer';
export type TransactionStatus = 'confirmed' | 'needs_review' | 'duplicate' | 'ignored' | 'failed';
export type TransactionSource = 'manual' | 'sms' | 'notification' | 'statement_import' | 'account_aggregator';

export interface TransactionsTable {
  id: Generated<string>;
  owner_id: string;
  organization_id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: Money;
  currency: Generated<string>;
  account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  occurred_at: Timestamp;
  merchant: string | null;
  source_name: string | null;
  description: string | null;
  notes: string | null;
  payment_method: string | null;
  external_reference: string | null;
  source: Generated<TransactionSource>;
  is_planned: boolean | null;
  is_essential: boolean | null;
  is_recurring: Generated<boolean>;
  duplicate_of_id: string | null;
  version: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  deleted_at: TimestampNullable;
}

export interface LedgerEntriesTable {
  id: Generated<string>;
  owner_id: string;
  transaction_id: string;
  account_id: string;
  amount: Money;
  created_at: GeneratedTimestamp;
}

export type CommitmentFrequency = 'once' | 'weekly' | 'monthly' | 'yearly' | 'custom_days';

export interface FinancialCommitmentsTable {
  id: Generated<string>;
  owner_id: string;
  organization_id: string;
  name: string;
  amount: Money;
  currency: Generated<string>;
  account_id: string;
  category_id: string | null;
  frequency: CommitmentFrequency;
  interval_count: Generated<number>;
  next_due_date: DateOnly;
  anchor_day: number;
  reminder_days_before: Generated<number>;
  status: Generated<'active' | 'cancelled' | 'completed'>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export type ReservationStatus = 'active' | 'reconciled' | 'released' | 'cancelled';

export interface MoneyReservationsTable {
  id: Generated<string>;
  owner_id: string;
  organization_id: string;
  commitment_id: string | null;
  account_id: string;
  name: string;
  target_amount: Money;
  reserved_amount: Money;
  due_date: DateOnly;
  status: Generated<ReservationStatus>;
  transaction_id: string | null;
  settled_amount: MoneyNullable;
  variance: MoneyNullable;
  closed_at: TimestampNullable;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface Database {
  organizations: OrganizationsTable;
  roles: RolesTable;
  permissions: PermissionsTable;
  role_permissions: RolePermissionsTable;
  users: UsersTable;
  organization_members: OrganizationMembersTable;
  sessions: SessionsTable;
  auth_tokens: AuthTokensTable;
  audit_logs: AuditLogsTable;
  bank_accounts: BankAccountsTable;
  transaction_categories: TransactionCategoriesTable;
  transactions: TransactionsTable;
  ledger_entries: LedgerEntriesTable;
  financial_commitments: FinancialCommitmentsTable;
  money_reservations: MoneyReservationsTable;
  _migrations: { name: string; applied_at: GeneratedTimestamp };
}

export type DB = Kysely<Database>;
export type Executor = Kysely<Database> | Transaction<Database>;
