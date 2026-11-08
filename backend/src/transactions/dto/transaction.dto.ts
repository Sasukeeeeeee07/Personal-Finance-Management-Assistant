import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { MONEY_PATTERN } from '../../common/money';
import type { TransactionSource, TransactionStatus, TransactionType } from '../../database/schema';

export const TRANSACTION_TYPES: TransactionType[] = ['income', 'expense', 'transfer'];
export const TRANSACTION_SOURCES: TransactionSource[] = ['manual', 'sms', 'notification', 'statement_import', 'account_aggregator'];
export const TRANSACTION_SORTS = ['occurredAt:desc', 'occurredAt:asc', 'amount:desc', 'amount:asc'] as const;
export type TransactionSort = (typeof TRANSACTION_SORTS)[number];
export const SETTABLE_STATUSES: TransactionStatus[] = ['confirmed', 'needs_review', 'ignored', 'failed'];
const POSITIVE_MONEY = /^(?!0+(\.0{1,2})?$)\d{1,17}(\.\d{1,2})?$/;
const MONEY_MSG = 'Enter an amount greater than 0, like 450 or 450.50.';

export class CreateTransactionDto {
  @ApiProperty({ enum: TRANSACTION_TYPES, description: 'Use transfer for moving money between your own accounts, including paying a credit card bill.' })
  @IsIn(TRANSACTION_TYPES, { message: 'Choose income, expense or transfer.' })
  type: TransactionType;

  @ApiProperty({ example: '450.00' })
  @Matches(POSITIVE_MONEY, { message: MONEY_MSG })
  amount: string;

  @ApiProperty({ description: 'Account the money comes from (expense/transfer) or goes into (income).' })
  @IsUUID('4', { message: 'Choose an account.' })
  accountId: string;

  @ApiPropertyOptional({ description: 'Required for transfers.' })
  @ValidateIf((o) => o.type === 'transfer')
  @IsUUID('4', { message: 'Choose the account the money goes to.' })
  destinationAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID('4')
  categoryId?: string;

  @ApiProperty({ example: '2026-11-08T13:45:00+05:30' })
  @IsISO8601({ strict: true }, { message: 'Enter a valid date and time.' })
  occurredAt: string;

  @ApiPropertyOptional({ example: 'Zomato' }) @IsOptional() @IsString() @MaxLength(120) merchant?: string;
  @ApiPropertyOptional({ description: 'Income source, e.g. employer or client', example: 'Acme Pvt Ltd' }) @IsOptional() @IsString() @MaxLength(120) sourceName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ example: 'upi' }) @IsOptional() @IsString() @MaxLength(40) paymentMethod?: string;
  @ApiPropertyOptional({ description: 'Bank/UPI reference number. Used to prevent counting the same transaction twice.' })
  @IsOptional() @IsString() @MaxLength(120)
  externalReference?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_SOURCES, default: 'manual' })
  @IsOptional() @IsIn(TRANSACTION_SOURCES)
  source?: TransactionSource;

  @ApiPropertyOptional({ enum: SETTABLE_STATUSES, default: 'confirmed' })
  @IsOptional() @IsIn(SETTABLE_STATUSES)
  status?: TransactionStatus;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPlanned?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isEssential?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRecurring?: boolean;

  @ApiPropertyOptional({
    description:
      'Explicit historical import: a statement line dated before the account tracking start date. Counted in analytics, never in the balance (the opening balance already includes it). Only for statement_import / account_aggregator sources.',
  })
  @IsOptional() @IsBoolean()
  historical?: boolean;

  @ApiPropertyOptional({ description: 'Pay a reserved commitment with this expense. The reservation is released in the same step, so money is not deducted twice.' })
  @IsOptional() @IsUUID('4')
  reservationId?: string;

  @ApiPropertyOptional({ description: 'Required when the amount differs from the reservation: confirms you reviewed the difference.' })
  @IsOptional() @IsBoolean()
  acceptReservationDifference?: boolean;
}

export class UpdateTransactionDto {
  @ApiProperty({ description: 'The version you are editing (optimistic locking).' })
  @IsInt() @Min(1)
  version: number;

  @ApiPropertyOptional({ enum: TRANSACTION_TYPES }) @IsOptional() @IsIn(TRANSACTION_TYPES) type?: TransactionType;
  @ApiPropertyOptional() @IsOptional() @Matches(POSITIVE_MONEY, { message: MONEY_MSG }) amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') accountId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID('4') destinationAccountId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID('4') categoryId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) occurredAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) merchant?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) sourceName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) paymentMethod?: string;
  @ApiPropertyOptional({ enum: SETTABLE_STATUSES }) @IsOptional() @IsIn(SETTABLE_STATUSES) status?: TransactionStatus;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPlanned?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isEssential?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRecurring?: boolean;
}

export class ListTransactionsQuery {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({ enum: TRANSACTION_TYPES }) @IsOptional() @IsIn(TRANSACTION_TYPES) type?: TransactionType;
  @ApiPropertyOptional({ enum: ['confirmed', 'needs_review', 'duplicate', 'ignored', 'failed'] }) @IsOptional() @IsIn(['confirmed', 'needs_review', 'duplicate', 'ignored', 'failed']) status?: TransactionStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
  @ApiPropertyOptional({ enum: TRANSACTION_SORTS, default: 'occurredAt:desc' }) @IsOptional() @IsIn(TRANSACTION_SORTS) sort?: TransactionSort;
}
