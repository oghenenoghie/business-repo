import type { RoundingMode } from "./types.js";

/** Exact-integer division with an explicit, declared rounding mode — never a float division. */
export function roundDivide(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) throw new Error("roundDivide: division by zero");

  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;

  let result: bigint;
  switch (mode) {
    case "truncate":
      result = quotient;
      break;
    case "half_up":
      result = remainder * 2n >= d ? quotient + 1n : quotient;
      break;
    case "half_even": {
      const twiceRemainder = remainder * 2n;
      if (twiceRemainder > d) result = quotient + 1n;
      else if (twiceRemainder < d) result = quotient;
      else result = quotient % 2n === 0n ? quotient : quotient + 1n;
      break;
    }
  }
  return negative ? -result : result;
}
