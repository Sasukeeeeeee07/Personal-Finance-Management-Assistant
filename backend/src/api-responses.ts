import { ApiProperty } from '@nestjs/swagger';
import { DateProp, MoneyProp, NullableString, PercentProp, TimestampProp, UuidProp } from './common/api-docs';

/**
 * OpenAPI response schemas for the endpoints the Flutter dashboard consumes (API contract v1).
 * These classes document responses only; services build plain objects. The response contract test
 * validates real responses against these schemas with no undocumented properties allowed.
 */

// --- auth -----------------------------------------------------------------------------------

export class MembershipResponse {
  @UuidProp() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['personal', 'business'] }) type: string;
  @ApiProperty({ example: 'free' }) plan: string;
  @ApiProperty({ example: 'org_admin' }) role: string;
}

export class MeResponse {
  @UuidProp() id: string;
  @ApiProperty() email: string;
  @ApiProperty() fullName: string;
  @ApiProperty() emailVerified: boolean;
  @NullableString({ example: null }) platformRole: string | null;
  @UuidProp() activeOrganizationId: string;
  @ApiProperty({ type: [MembershipResponse] }) organizations: MembershipResponse[];
  @ApiProperty({ type: [String], example: ['finance.own.read'] }) permissions: string[];
}

// --- accounts and categories ------------------------------------------------------------------

export class AccountResponse {
  @UuidProp() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['savings', 'current', 'cash', 'upi_bank', 'credit_card', 'wallet', 'fixed_deposit', 'other'] }) type: string;
  @NullableString() institutionName: string | null;
  @NullableString({ description: 'Last 2–4 digits only' }) accountMask: string | null;
  @ApiProperty({ example: 'INR' }) currency: string;
  @ApiProperty() isLiquid: boolean;
  @ApiProperty() isLiability: boolean;
  @MoneyProp({ nullable: true }) creditLimit: string | null;
  @DateProp({ nullable: true }) openingDate: string | null;
  @DateProp() trackingStartDate: string;
  @ApiProperty() archived: boolean;
  @MoneyProp({ description: 'Signed ledger balance; negative on a credit card means money owed' }) balance: string;
  @MoneyProp({ nullable: true, description: 'Amount owed, liabilities only' }) outstanding: string | null;
  @MoneyProp({ nullable: true }) availableCredit: string | null;
}

export class CategoryResponse {
  @UuidProp() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['income', 'expense'] }) kind: string;
  @ApiProperty() isEssential: boolean;
  @NullableString() icon: string | null;
  @ApiProperty() isCustom: boolean;
}

// --- budgets ----------------------------------------------------------------------------------

export class BudgetCurrentResponse {
  @DateProp() asOf: string;
  @DateProp() periodStart: string;
  @DateProp({ description: 'Exclusive' }) periodEnd: string;
  @ApiProperty({ description: 'Use with GET /transactions?from=' }) transactionsFrom: string;
  @ApiProperty({ description: 'Use with GET /transactions?to=' }) transactionsTo: string;
  @MoneyProp() limit: string;
  @MoneyProp() carriedOver: string;
  @MoneyProp() spent: string;
  @MoneyProp({ description: 'Negative when over budget' }) remaining: string;
  @PercentProp() utilizationPercent: string;
  @ApiProperty() daysLeft: number;
  @MoneyProp() dailyTarget: string;
  @ApiProperty({ type: [Number] }) thresholdsReached: number[];
  @ApiProperty() exceeded: boolean;
  @ApiProperty({ enum: ['on_track', 'warning', 'exceeded'] }) health: string;
  @ApiProperty({ type: Number, nullable: true }) healthWarningFromPercent: number | null;
}

export class BudgetResponse {
  @UuidProp() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['overall', 'category'] }) scope: string;
  @UuidProp({ nullable: true }) categoryId: string | null;
  @ApiProperty({ enum: ['monthly', 'weekly', 'custom'] }) period: string;
  @ApiProperty({ type: Number, nullable: true }) periodDays: number | null;
  @MoneyProp() amount: string;
  @ApiProperty() currency: string;
  @DateProp() startDate: string;
  @ApiProperty() rollover: boolean;
  @ApiProperty({ type: [Number] }) alertThresholds: number[];
  @ApiProperty({ enum: ['active', 'archived'] }) status: string;
  @ApiProperty({ type: BudgetCurrentResponse }) current: BudgetCurrentResponse;
}

// --- dashboard --------------------------------------------------------------------------------

export class MonthlyBudgetSnapshot {
  @UuidProp() budgetId: string;
  @MoneyProp() limit: string;
  @MoneyProp() spent: string;
  @MoneyProp() remaining: string;
  @PercentProp() utilizationPercent: string;
  @MoneyProp() dailyTarget: string;
}

export class UpcomingPaymentResponse {
  @UuidProp() reservationId: string;
  @ApiProperty() name: string;
  @MoneyProp({ description: 'Full amount due' }) amount: string;
  @MoneyProp({ description: 'Amount set aside so far' }) reserved: string;
  @DateProp() dueDate: string;
  @UuidProp() accountId: string;
  @ApiProperty() overdue: boolean;
}

export class CalculationResponse {
  @ApiProperty() formula: string;
  @ApiProperty({ type: [String] }) notes: string[];
}

export class DashboardSummaryResponse {
  @DateProp() asOf: string;
  @ApiProperty({ example: 'INR' }) currency: string;
  @MoneyProp({ description: 'All non-liability accounts, including fixed deposits' }) totalBalance: string;
  @MoneyProp({ description: 'All accounts, liabilities negative' }) netPosition: string;
  @MoneyProp() liquidBalance: string;
  @MoneyProp() reserved: string;
  @MoneyProp({ description: 'Goal savings in reserve mode' }) allocated: string;
  @MoneyProp() availableToSpend: string;
  @ApiProperty() overcommitted: boolean;
  @MoneyProp() creditCardOutstanding: string;
  @MoneyProp() monthIncome: string;
  @MoneyProp() monthExpenses: string;
  @MoneyProp() monthNet: string;
  @ApiProperty() needsReviewCount: number;
  @MoneyProp({ description: 'Total saved across goals (track-only and reserve)' }) savings: string;
  @ApiProperty({ type: MonthlyBudgetSnapshot, nullable: true }) monthlyBudget: MonthlyBudgetSnapshot | null;
  @ApiProperty({ type: [UpcomingPaymentResponse], description: 'Up to 10 open reservations, earliest due first' }) upcomingPayments: UpcomingPaymentResponse[];
  @ApiProperty({ type: CalculationResponse }) calculation: CalculationResponse;
}

// --- forecast ---------------------------------------------------------------------------------

export class ForecastItemResponse {
  @ApiProperty() name: string;
  @MoneyProp() amount: string;
  @DateProp() date: string;
}

export class ForecastItemGroupResponse {
  @MoneyProp() total: string;
  @ApiProperty({ type: [ForecastItemResponse] }) items: ForecastItemResponse[];
}

export class ForecastWindowResponse {
  @ApiProperty({ enum: ['last_7_days', 'days_8_to_30', 'days_31_to_90'] }) label: string;
  @ApiProperty() coveredDays: number;
  @MoneyProp() total: string;
  @MoneyProp() dailyAverage: string;
  @ApiProperty({ description: 'Effective weight after redistribution (0–1)' }) weight: number;
}

export class VariableSpendingResponse {
  @MoneyProp() total: string;
  @MoneyProp() dailyAverage: string;
  @ApiProperty({ enum: ['weighted_recent', 'simple_average', 'no_history'] }) method: string;
  @ApiProperty() historyDays: number;
  @ApiProperty({ type: [ForecastWindowResponse] }) windows: ForecastWindowResponse[];
}

export class ForecastResponse {
  @ApiProperty({ example: 'forecast-v2' }) methodVersion: string;
  @DateProp() asOf: string;
  @TimestampProp() calculatedAt: string;
  @DateProp() monthEnd: string;
  @ApiProperty() daysLeft: number;
  @ApiProperty() currency: string;
  @MoneyProp() startingLiquidBalance: string;
  @ApiProperty({ type: ForecastItemGroupResponse }) expectedIncome: ForecastItemGroupResponse;
  @ApiProperty({ type: ForecastItemGroupResponse }) scheduledPayments: ForecastItemGroupResponse;
  @ApiProperty({ type: ForecastItemGroupResponse }) expectedRecurringExpenses: ForecastItemGroupResponse;
  @ApiProperty({ type: VariableSpendingResponse }) variableSpending: VariableSpendingResponse;
  @MoneyProp() estimatedMonthEndBalance: string;
  @MoneyProp() estimatedAvailableAtMonthEnd: string;
  @MoneyProp({ description: 'Available-to-spend at the end of asOf' }) availableNow: string;
  @MoneyProp({ description: 'estimatedAvailableAtMonthEnd − availableNow' }) availableChangeByMonthEnd: string;
  @ApiProperty() shortfallRisk: boolean;
  @ApiProperty({ enum: ['low', 'medium', 'high'] }) confidence: string;
  @ApiProperty() formula: string;
  @ApiProperty({ type: [String] }) assumptions: string[];
}

// --- transactions -----------------------------------------------------------------------------

export class TransactionResponse {
  @UuidProp() id: string;
  @ApiProperty({ enum: ['income', 'expense', 'transfer'] }) type: string;
  @ApiProperty({ enum: ['confirmed', 'needs_review', 'duplicate', 'ignored', 'failed'] }) status: string;
  @MoneyProp() amount: string;
  @ApiProperty() currency: string;
  @UuidProp() accountId: string;
  @UuidProp({ nullable: true }) destinationAccountId: string | null;
  @UuidProp({ nullable: true }) categoryId: string | null;
  @TimestampProp() occurredAt: string;
  @NullableString() merchant: string | null;
  @NullableString() sourceName: string | null;
  @NullableString() description: string | null;
  @NullableString() notes: string | null;
  @NullableString() paymentMethod: string | null;
  @NullableString() externalReference: string | null;
  @ApiProperty({ enum: ['manual', 'sms', 'notification', 'statement_import', 'account_aggregator'] }) source: string;
  @ApiProperty({ type: Boolean, nullable: true }) isPlanned: boolean | null;
  @ApiProperty({ type: Boolean, nullable: true }) isEssential: boolean | null;
  @ApiProperty() isRecurring: boolean;
  @UuidProp({ nullable: true }) duplicateOfId: string | null;
  @ApiProperty() isHistorical: boolean;
  @ApiProperty() version: number;
  @TimestampProp() createdAt: string;
  @TimestampProp() updatedAt: string;
}

export class TransactionListResponse {
  @ApiProperty({ type: [TransactionResponse] }) items: TransactionResponse[];
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty() total: number;
  @ApiProperty({ enum: ['occurredAt:desc', 'occurredAt:asc', 'amount:desc', 'amount:asc'] }) sort: string;
}

export class TransactionInsightResponse {
  @UuidProp() categoryId: string;
  @MoneyProp() categorySpentThisMonth: string;
  @MoneyProp() categorySpentLastMonth: string;
  @MoneyProp() changeFromLastMonth: string;
  @ApiProperty({ type: BudgetResponse, nullable: true, description: 'Category budget this expense counts against' }) budget: BudgetResponse | null;
}

export class TransactionDetailResponse extends TransactionResponse {
  @ApiProperty({ type: TransactionInsightResponse, nullable: true, description: 'Expenses with a category only' }) insight: TransactionInsightResponse | null;
}

// --- reports ----------------------------------------------------------------------------------

export class CategoryTotalResponse {
  @UuidProp({ nullable: true }) categoryId: string | null;
  @ApiProperty({ example: 'Food' }) name: string;
  @MoneyProp() total: string;
  @PercentProp() sharePercent: string;
  @ApiProperty() count: number;
}

export class LargestExpenseResponse {
  @UuidProp() id: string;
  @MoneyProp() amount: string;
  @ApiProperty() label: string;
  @NullableString() category: string | null;
  @TimestampProp() occurredAt: string;
}

export class PreviousMonthResponse {
  @ApiProperty({ example: '2026-10' }) month: string;
  @MoneyProp() income: string;
  @MoneyProp() expenses: string;
  @MoneyProp() incomeChange: string;
  @MoneyProp() expensesChange: string;
}

export class MonthlyReportResponse {
  @ApiProperty({ example: '2026-11' }) month: string;
  @DateProp() periodStart: string;
  @DateProp({ description: 'Exclusive' }) periodEnd: string;
  @ApiProperty() currency: string;
  @MoneyProp() income: string;
  @MoneyProp() expenses: string;
  @MoneyProp() net: string;
  @PercentProp({ nullable: true }) savingsRatePercent: string | null;
  @ApiProperty() expenseCount: number;
  @MoneyProp() essential: string;
  @MoneyProp() nonEssential: string;
  @MoneyProp() planned: string;
  @MoneyProp() unplanned: string;
  @ApiProperty({ type: [CategoryTotalResponse] }) expensesByCategory: CategoryTotalResponse[];
  @ApiProperty({ type: [CategoryTotalResponse] }) incomeByCategory: CategoryTotalResponse[];
  @ApiProperty({ type: [LargestExpenseResponse] }) largestExpenses: LargestExpenseResponse[];
  @ApiProperty({ type: PreviousMonthResponse }) previousMonth: PreviousMonthResponse;
  @ApiProperty({ type: [String] }) notes: string[];
}

// --- Money Lock -------------------------------------------------------------------------------

export class CommitmentResponse {
  @UuidProp() id: string;
  @ApiProperty() name: string;
  @MoneyProp() amount: string;
  @ApiProperty() currency: string;
  @UuidProp() accountId: string;
  @UuidProp({ nullable: true }) categoryId: string | null;
  @ApiProperty({ enum: ['once', 'weekly', 'monthly', 'yearly', 'custom_days'] }) frequency: string;
  @ApiProperty() intervalCount: number;
  @DateProp() nextDueDate: string;
  @ApiProperty() reminderDaysBefore: number;
  @ApiProperty({ enum: ['active', 'cancelled', 'completed'] }) status: string;
}

export class ReservationResponse {
  @UuidProp() id: string;
  @UuidProp({ nullable: true }) commitmentId: string | null;
  @UuidProp() accountId: string;
  @ApiProperty() name: string;
  @MoneyProp() targetAmount: string;
  @MoneyProp() reservedAmount: string;
  @MoneyProp() shortfall: string;
  @ApiProperty() fullyReserved: boolean;
  @DateProp() dueDate: string;
  @ApiProperty({ enum: ['active', 'reconciled', 'released', 'cancelled'] }) status: string;
  @ApiProperty() overdue: boolean;
  @UuidProp({ nullable: true }) transactionId: string | null;
  @MoneyProp({ nullable: true }) settledAmount: string | null;
  @MoneyProp({ nullable: true }) variance: string | null;
  @TimestampProp({ nullable: true }) closedAt: string | null;
  @NullableString() closeReason: string | null;
  @DateProp() occurrenceDate: string;
  @UuidProp({ nullable: true }) createdFromReservationId: string | null;
}

// --- goals ------------------------------------------------------------------------------------

export class GoalResponse {
  @UuidProp() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['emergency_fund', 'gadget', 'vacation', 'education', 'vehicle', 'savings', 'custom'] }) kind: string;
  @MoneyProp() targetAmount: string;
  @ApiProperty() currency: string;
  @DateProp({ nullable: true }) targetDate: string | null;
  @MoneyProp({ nullable: true }) monthlyContribution: string | null;
  @ApiProperty({ description: '1 high, 2 medium, 3 low' }) priority: number;
  @UuidProp({ nullable: true }) accountId: string | null;
  @ApiProperty({ enum: ['track_only', 'reserve'] }) allocationMode: string;
  @ApiProperty({ enum: ['active', 'completed', 'archived'] }) status: string;
  @TimestampProp({ nullable: true }) completedAt: string | null;
  @MoneyProp() saved: string;
  @MoneyProp() allocated: string;
  @MoneyProp() movedByTransfers: string;
  @MoneyProp() remaining: string;
  @PercentProp() progressPercent: string;
  @MoneyProp({ nullable: true }) recommendedMonthly: string | null;
  @DateProp({ nullable: true }) estimatedCompletionDate: string | null;
  @ApiProperty({ type: String, nullable: true, enum: ['planned_monthly_contribution', 'average_of_last_3_months'] }) estimateBasis: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) onTrack: boolean | null;
  @ApiProperty() targetDatePassed: boolean;
  @ApiProperty({ type: Number, nullable: true }) daysToTarget: number | null;
}

export class GoalContributionResponse {
  @UuidProp() id: string;
  @MoneyProp() amount: string;
  @ApiProperty({ enum: ['contribution', 'withdrawal', 'reversal'] }) type: string;
  @DateProp() date: string;
  @NullableString() note: string | null;
  @UuidProp({ nullable: true }) transactionId: string | null;
  @UuidProp({ nullable: true }) reversesContributionId: string | null;
  @ApiProperty() reversed: boolean;
}

export class GoalDetailResponse extends GoalResponse {
  @ApiProperty({ type: [GoalContributionResponse] }) contributions: GoalContributionResponse[];
}
