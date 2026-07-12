import { describe, expect, it } from "vitest";
import { roundDivide } from "../src/rounding.js";

describe("roundDivide", () => {
  it("truncate drops the remainder", () => {
    expect(roundDivide(10n, 3n, "truncate")).toBe(3n);
    expect(roundDivide(-10n, 3n, "truncate")).toBe(-3n);
  });

  it("half_up rounds 0.5 away from zero", () => {
    expect(roundDivide(5n, 2n, "half_up")).toBe(3n); // 2.5 -> 3
    expect(roundDivide(4n, 2n, "half_up")).toBe(2n); // exact
    expect(roundDivide(-5n, 2n, "half_up")).toBe(-3n);
  });

  it("half_even rounds 0.5 to the nearest even quotient (banker's rounding)", () => {
    expect(roundDivide(5n, 2n, "half_even")).toBe(2n); // 2.5 -> 2 (even)
    expect(roundDivide(7n, 2n, "half_even")).toBe(4n); // 3.5 -> 4 (even)
    expect(roundDivide(9n, 2n, "half_even")).toBe(4n); // 4.5 -> 4 (even)
  });

  it("throws on division by zero", () => {
    expect(() => roundDivide(1n, 0n, "half_up")).toThrow();
  });

  it("exact divisions are unaffected by rounding mode", () => {
    for (const mode of ["truncate", "half_up", "half_even"] as const) {
      expect(roundDivide(100n, 4n, mode)).toBe(25n);
    }
  });
});
