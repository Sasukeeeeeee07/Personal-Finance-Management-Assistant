import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MONEY_PATTERN } from '../../common/money';
import type { CommitmentFrequency } from '../../database/schema';

const POSITIVE_MONEY = /^(?!0+(\.0{1,2})?$)\d{1,17}(\.\d{1,2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const FREQUENCIES: CommitmentFrequency[] = ['once', 'weekly', 'monthly', 'yearly', 'custom_days'];

export class CreateCommitmentDto {
  @ApiProperty({ example: 'Rent' }) @IsString() @MinLength(1, { message: 'Enter a name.' }) @MaxLength(80) name: string;
  @ApiProperty({ example: '8000.00' }) @Matches(POSITIVE_MONEY, { message: 'Enter an amount greater than 0.' }) amount: string;
  @ApiProperty({ description: 'Account the payment will be made from.' }) @IsUUID('4', { message: 'Choose a payment account.' }) accountId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') categoryId?: string;
  @ApiProperty({ enum: FREQUENCIES }) @IsIn(FREQUENCIES, { message: 'Choose how often this repeats.' }) frequency: CommitmentFrequency;
  @ApiPropertyOptional({ description: 'Every N periods; for custom_days, the number of days.', default: 1 })
  @IsOptional() @IsInt() @Min(1) @Max(366)
  intervalCount?: number;
  @ApiProperty({ example: '2026-12-01' }) @Matches(DATE_ONLY, { message: 'Enter a due date as YYYY-MM-DD.' }) dueDate: string;
  @ApiPropertyOptional({ default: 3 }) @IsOptional() @IsInt() @Min(0) @Max(30) reminderDaysBefore?: number;
  @ApiPropertyOptional({ description: 'How much to set aside now. Defaults to the full amount; less = partial reservation.', example: '8000.00' })
  @IsOptional() @Matches(MONEY_PATTERN, { message: 'Enter an amount like 4000 or 4000.50.' })
  reserveAmount?: string;
}

export class CreateReservationDto {
  @ApiProperty({ example: 'Insurance premium' }) @IsString() @MinLength(1) @MaxLength(80) name: string;
  @ApiProperty() @IsUUID('4') accountId: string;
  @ApiProperty({ example: '12000.00' }) @Matches(POSITIVE_MONEY, { message: 'Enter an amount greater than 0.' }) targetAmount: string;
  @ApiPropertyOptional({ description: 'Defaults to targetAmount.' }) @IsOptional() @Matches(MONEY_PATTERN) reservedAmount?: string;
  @ApiProperty({ example: '2026-12-15' }) @Matches(DATE_ONLY, { message: 'Enter a due date as YYYY-MM-DD.' }) dueDate: string;
}

export class AdjustReservationDto {
  @ApiProperty({ description: 'New amount set aside (0 to target).', example: '5000.00' })
  @Matches(MONEY_PATTERN, { message: 'Enter an amount like 5000 or 5000.50.' })
  reservedAmount: string;
}

export class SettleReservationDto {
  @ApiProperty({ description: 'An existing confirmed expense or transfer that paid this commitment.' })
  @IsUUID('4')
  transactionId: string;

  @ApiPropertyOptional({ description: 'Confirm you reviewed a difference between the reserved and paid amount.' })
  @IsOptional() @IsBoolean()
  acceptDifference?: boolean;
}

export class ListReservationsQuery {
  @ApiPropertyOptional({ enum: ['active', 'reconciled', 'released', 'cancelled'] })
  @IsOptional() @IsIn(['active', 'reconciled', 'released', 'cancelled'])
  status?: 'active' | 'reconciled' | 'released' | 'cancelled';
}
