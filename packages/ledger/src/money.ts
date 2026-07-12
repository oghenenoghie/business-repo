// Minor-unit exponent per currency. Not all currencies have two decimals —
// hardcoding `× 100` corrupts every KWD/BHD/OMR figure by a factor of ten.
export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  NGN: 2,
  USD: 2,
  GBP: 2,
  EUR: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JPY: 0,
};

export function minorUnitsPerMajor(currency: string): bigint {
  const exponent = CURRENCY_EXPONENTS[currency];
  if (exponent === undefined) {
    throw new Error(`unknown currency exponent for ${currency}`);
  }
  return 10n ** BigInt(exponent);
}

/** pg returns bigint columns as strings to avoid silent precision loss beyond Number.MAX_SAFE_INTEGER. */
export function toBigInt(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}
