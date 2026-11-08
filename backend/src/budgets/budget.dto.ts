import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import type { BudgetPeriod } from '../database/schema';

const POSITIVE_MONEY = /^(?!0+(\.0{1,2})?$)\d{1,17}(\.\d{1,2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const BUDGET_PERIODS: BudgetPeriod[] = ['monthly', 'weekly', 'custom'];

export class CreateBudgetDto {
  @ApiProperty({ example: 'Food' }) @IsString() @MinLength(1, { message: 'Enter a budget name.' }) @MaxLength(80) name: string;

  @ApiPropertyOptional({ description: 'Leave empty for an overall spending limit.' })
  @IsOptional() @IsUUID('4')
  categoryId?: string;

  @ApiProperty({ enum: BUDGET_PERIODS }) @IsIn(BUDGET_PERIODS, { message: 'Choose monthly, weekly or custom.' }) period: BudgetPeriod;

  @ApiPropertyOptional({ description: 'Required for custom periods: length in days.' })
  @ValidateIf((o) => o.period === 'custom')
  @IsInt({ message: 'Enter the number of days in each period.' }) @Min(1) @Max(366)
  periodDays?: number;

  @ApiProperty({ example: '4000.00' }) @Matches(POSITIVE_MONEY, { message: 'Enter an amount greater than 0.' }) amount: string;

  @ApiPropertyOptional({
    description: 'First day of the first period. For monthly budgets, its day-of-month is the reset day. Defaults to the 1st of this month (monthly) or today.',
    example: '2026-11-01',
  })
  @IsOptional() @Matches(DATE_ONLY, { message: 'Enter a date as YYYY-MM-DD.' })
  startDate?: string;

  @ApiPropertyOptional({ description: "Carry the previous period's unused amount into the next period." })
  @IsOptional() @IsBoolean()
  rollover?: boolean;

  @ApiPropertyOptional({ example: [50, 75, 90, 100], description: 'Percent thresholds that trigger an alert (1–100).' })
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(10) @IsInt({ each: true }) @Min(1, { each: true }) @Max(100, { each: true })
  alertThresholds?: number[];
}

export class UpdateBudgetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(POSITIVE_MONEY, { message: 'Enter an amount greater than 0.' }) amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() rollover?: boolean;
  @ApiPropertyOptional()
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(10) @IsInt({ each: true }) @Min(1, { each: true }) @Max(100, { each: true })
  alertThresholds?: number[];
}

export class AsOfQuery {
  @ApiPropertyOptional({ description: 'Evaluate as of this date (YYYY-MM-DD). Defaults to today.' })
  @IsOptional() @Matches(DATE_ONLY, { message: 'Enter a date as YYYY-MM-DD.' })
  asOf?: string;
}
