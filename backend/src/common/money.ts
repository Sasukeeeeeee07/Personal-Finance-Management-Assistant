import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

/** Matches a positive or zero amount with at most 2 decimals, e.g. "8000", "450.5", "0.01". */
export const MONEY_PATTERN = /^\d{1,17}(\.\d{1,2})?$/;

export function money(value: string | number | Decimal): Decimal {
  return new Decimal(value);
}

/** Canonical 2-decimal string for API responses and DB writes. */
export function fmt(value: Decimal | string | number): string {
  return new Decimal(value).toFixed(2);
}

export function sum(values: (string | null | undefined)[]): Decimal {
  return values.reduce<Decimal>((acc, v) => (v == null ? acc : acc.plus(v)), new Decimal(0));
}
