import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import type { GoalKind } from '../database/schema';

const POSITIVE_MONEY = /^(?!0+(\.0{1,2})?$)\d{1,17}(\.\d{1,2})?$/;
const MONEY = /^\d{1,17}(\.\d{1,2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const GOAL_KINDS: GoalKind[] = ['emergency_fund', 'gadget', 'vacation', 'education', 'vehicle', 'savings', 'custom'];

export class CreateGoalDto {
  @ApiProperty({ example: 'Emergency fund' }) @IsString() @MinLength(1, { message: 'Enter a goal name.' }) @MaxLength(80) name: string;
  @ApiPropertyOptional({ enum: GOAL_KINDS, default: 'custom' }) @IsOptional() @IsIn(GOAL_KINDS) kind?: GoalKind;
  @ApiProperty({ example: '100000.00' }) @Matches(POSITIVE_MONEY, { message: 'Enter a target greater than 0.' }) targetAmount: string;
  @ApiPropertyOptional({ example: '2027-06-30' }) @IsOptional() @Matches(DATE_ONLY, { message: 'Enter a date as YYYY-MM-DD.' }) targetDate?: string;
  @ApiPropertyOptional({ example: '5000.00' }) @IsOptional() @Matches(POSITIVE_MONEY, { message: 'Enter an amount greater than 0.' }) monthlyContribution?: string;
  @ApiPropertyOptional({ description: '1 = high, 2 = medium, 3 = low', default: 2 }) @IsOptional() @IsInt() @Min(1) @Max(3) priority?: number;
  @ApiPropertyOptional({ description: 'Account where this money is kept (optional).' }) @IsOptional() @IsUUID('4') accountId?: string;
  @ApiPropertyOptional({ description: 'Amount already saved for this goal.', example: '10000.00' })
  @IsOptional() @Matches(MONEY, { message: 'Enter an amount like 10000 or 10000.50.' })
  initialAmount?: string;
}

export class UpdateGoalDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @ApiPropertyOptional({ enum: GOAL_KINDS }) @IsOptional() @IsIn(GOAL_KINDS) kind?: GoalKind;
  @ApiPropertyOptional() @IsOptional() @Matches(POSITIVE_MONEY, { message: 'Enter a target greater than 0.' }) targetAmount?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATE_ONLY) targetDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(POSITIVE_MONEY) monthlyContribution?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3) priority?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID('4') accountId?: string | null;
}

export class ContributionDto {
  @ApiProperty({ enum: ['contribution', 'withdrawal'] }) @IsIn(['contribution', 'withdrawal']) type: 'contribution' | 'withdrawal';
  @ApiProperty({ example: '5000.00' }) @Matches(POSITIVE_MONEY, { message: 'Enter an amount greater than 0.' }) amount: string;
  @ApiPropertyOptional({ example: '2026-11-08', description: 'Defaults to today.' }) @IsOptional() @Matches(DATE_ONLY) date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
  @ApiPropertyOptional({ description: 'Optional: the transfer that physically moved this money.' }) @IsOptional() @IsUUID('4') transactionId?: string;
}
