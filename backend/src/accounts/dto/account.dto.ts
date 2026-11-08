import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { MONEY_PATTERN } from '../../common/money';
import type { AccountType } from '../../database/schema';

export const ACCOUNT_TYPES: AccountType[] = ['savings', 'current', 'cash', 'upi_bank', 'credit_card', 'wallet', 'fixed_deposit', 'other'];
const MONEY_MSG = 'Enter an amount like 2500 or 2500.50.';

export class CreateAccountDto {
  @ApiProperty({ example: 'HDFC Savings' })
  @IsString() @MinLength(1, { message: 'Enter an account name.' }) @MaxLength(80)
  name: string;

  @ApiProperty({ enum: ACCOUNT_TYPES })
  @IsIn(ACCOUNT_TYPES, { message: 'Choose an account type.' })
  type: AccountType;

  @ApiPropertyOptional({ example: 'HDFC Bank' })
  @IsOptional() @IsString() @MaxLength(80)
  institutionName?: string;

  @ApiPropertyOptional({ description: 'Last 2–4 digits only. Never send a full account or card number.', example: '4821' })
  @IsOptional() @Matches(/^[0-9]{2,4}$/, { message: 'Enter only the last 2–4 digits.' })
  accountMask?: string;

  @ApiPropertyOptional({ example: 'INR', default: 'INR' })
  @IsOptional() @Length(3, 3) @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({
    description: 'Current balance when you start tracking. For credit cards, enter the amount you currently owe.',
    example: '30000.00',
  })
  @IsOptional() @Matches(MONEY_PATTERN, { message: MONEY_MSG })
  openingBalance?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional() @IsDateString({ strict: true })
  openingDate?: string;

  @ApiPropertyOptional({ description: 'Override whether this counts as spendable money (defaults by type).' })
  @IsOptional() @IsBoolean()
  isLiquid?: boolean;

  @ApiPropertyOptional({ example: '100000.00' })
  @IsOptional() @Matches(MONEY_PATTERN, { message: MONEY_MSG })
  creditLimit?: string;
}

export class UpdateAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) institutionName?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[0-9]{2,4}$/, { message: 'Enter only the last 2–4 digits.' }) accountMask?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isLiquid?: boolean;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY_PATTERN, { message: MONEY_MSG }) creditLimit?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() archived?: boolean;
}

export class ReconcileAccountDto {
  @ApiProperty({ description: 'The balance your bank or wallet shows right now. For credit cards, the amount owed.', example: '29450.00' })
  @Matches(MONEY_PATTERN, { message: MONEY_MSG })
  actualBalance: string;
}
