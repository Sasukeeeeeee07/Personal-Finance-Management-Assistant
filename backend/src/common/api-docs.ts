import { ApiProperty, ApiPropertyOptions } from '@nestjs/swagger';

/**
 * Swagger helpers for response schemas. The patterns are enforced by the response contract test
 * (test/response-contract.e2e-spec.ts), so documented formats and real responses cannot drift.
 */
export const MONEY_RESPONSE_PATTERN = '^-?\\d{1,17}\\.\\d{2}$';
export const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
export const PERCENT_PATTERN = '^\\d{1,6}\\.\\d{2}$';

type Opts = Omit<ApiPropertyOptions, 'type'> & { nullable?: boolean };

/** Decimal money string with exactly two decimals, e.g. "8000.00". Never a number. */
export const MoneyProp = (opts: Opts = {}) =>
  ApiProperty({ type: String, pattern: MONEY_RESPONSE_PATTERN, example: '8000.00', ...opts } as ApiPropertyOptions);

/** Calendar date in India time, YYYY-MM-DD. */
export const DateProp = (opts: Opts = {}) => ApiProperty({ type: String, pattern: DATE_PATTERN, example: '2026-11-08', ...opts } as ApiPropertyOptions);

/** ISO 8601 UTC timestamp. */
export const TimestampProp = (opts: Opts = {}) =>
  ApiProperty({ type: String, format: 'date-time', example: '2026-11-08T04:30:00.000Z', ...opts } as ApiPropertyOptions);

/** Percentage as a 2-decimal string, e.g. "62.50". */
export const PercentProp = (opts: Opts = {}) => ApiProperty({ type: String, pattern: PERCENT_PATTERN, example: '62.50', ...opts } as ApiPropertyOptions);

export const UuidProp = (opts: Opts = {}) => ApiProperty({ type: String, format: 'uuid', ...opts } as ApiPropertyOptions);

export const NullableString = (opts: Opts = {}) => ApiProperty({ type: String, nullable: true, ...opts } as ApiPropertyOptions);
