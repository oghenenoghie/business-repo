import { describe, expect, it } from "vitest";
import { calculatePayslip } from "../../src/interpreter.js";
import { NG_2026 } from "../../src/jurisdictions/ng2026.js";
import type { EmployeeSnapshot } from "../../src/types.js";

/**
 * Hand-verified golden cases against NG_2026 (Nigeria Tax Act 2025, Fourth
 * Schedule, effective 2026-01-01 — see the sources cited at the top of
 * src/jurisdictions/ng2026.ts). Each expectation below is computed by hand
 * from the same band table and shown in the comment above it, in kobo, so a
 * reviewer can check the arithmetic without running anything.
 *
 * All three cases land on exact-kobo monthly PAYE (annual tax happens to be
 * a multiple of 12 for these inputs), so none of them depend on the
 * rounding mode to pass — rounding itself is covered separately in
 * tests/rounding.spec.ts.
 */
describe("golden: NG_2026 payroll", () => {
  it("mid-level earner, pension opted in, NHF opted out, no rent relief claimed", () => {
    // BASIC 300,000 + HOUSING 100,000 + TRANSPORT 50,000 = GROSS 450,000 (all ₦, monthly)
    // PENSIONABLE_EMOLUMENT = 450,000; PENSION_EMPLOYEE = 8% = 36,000; PENSION_EMPLOYER = 10% = 45,000
    // NHF = 0 (opted out); RENT_RELIEF = 0 (no rent claimed)
    // Taxable monthly = 450,000 - 36,000 = 414,000; annualized ×12 = 4,968,000
    //   Band 1:      800,000 @ 0%  -> 0;            remaining 4,168,000
    //   Band 2:    2,200,000 @ 15% -> 330,000;       remaining 1,968,000
    //   Band 3 (partial): 1,968,000 @ 18% -> 354,240; remaining 0
    //   Annual PAYE = 684,240 -> monthly PAYE = 684,240 / 12 = 57,020 (exact)
    // NET = 450,000 - 36,000 - 57,020 = 356,980
    const snapshot: EmployeeSnapshot = {
      employeeId: "ng-1",
      nationality: "NG",
      employeeType: "full_time",
      flags: { pensionOptIn: true, nhfOptIn: false },
      values: {
        BASIC: 300_000_00n,
        HOUSING: 100_000_00n,
        TRANSPORT: 50_000_00n,
        ANNUAL_RENT: 0n,
      },
    };

    const result = calculatePayslip(snapshot, NG_2026, "2026-03");

    expect(result.gross).toBe(450_000_00n);
    expect(result.lines.find((l) => l.code === "PENSION_EMPLOYEE")?.amount).toBe(36_000_00n);
    expect(result.lines.find((l) => l.code === "PENSION_EMPLOYER")?.amount).toBe(45_000_00n);
    expect(result.lines.find((l) => l.code === "NHF")).toBeUndefined();
    expect(result.lines.find((l) => l.code === "PAYE")?.amount).toBe(57_020_00n);
    expect(result.totalDeductions).toBe(36_000_00n + 57_020_00n);
    expect(result.net).toBe(356_980_00n);
  });

  it("low earner falls entirely inside the 0% band — PAYE is zero", () => {
    // BASIC 50,000, no housing/transport. GROSS = 50,000.
    // PENSION_EMPLOYEE = 8% of 50,000 = 4,000. Taxable monthly = 46,000.
    // Annualized = 552,000, which is below the 800,000 threshold -> PAYE = 0.
    // NET = 50,000 - 4,000 - 0 = 46,000
    const snapshot: EmployeeSnapshot = {
      employeeId: "ng-2",
      nationality: "NG",
      employeeType: "full_time",
      flags: { pensionOptIn: true, nhfOptIn: false },
      values: { BASIC: 50_000_00n, HOUSING: 0n, TRANSPORT: 0n, ANNUAL_RENT: 0n },
    };

    const result = calculatePayslip(snapshot, NG_2026, "2026-03");

    expect(result.lines.find((l) => l.code === "PAYE")?.amount).toBe(0n);
    expect(result.net).toBe(46_000_00n);
  });

  it("high earner with NHF opted in and rent relief capped at ₦500,000", () => {
    // BASIC 2,000,000 + HOUSING 500,000 + TRANSPORT 200,000 = GROSS 2,700,000
    // PENSIONABLE_EMOLUMENT = 2,700,000; PENSION_EMPLOYEE = 8% = 216,000
    // NHF = 2.5% of BASIC (2,000,000) = 50,000
    // ANNUAL_RENT = 6,000,000; 20% = 1,200,000, capped at 500,000 -> RENT_RELIEF = 500,000
    // Taxable monthly = 2,700,000 - 216,000 - 50,000 - 500,000 = 1,934,000
    // Annualized ×12 = 23,208,000
    //   Band 1:      800,000 @ 0%  -> 0;              remaining 22,408,000
    //   Band 2:    2,200,000 @ 15% -> 330,000;         remaining 20,208,000
    //   Band 3:    9,000,000 @ 18% -> 1,620,000;       remaining 11,208,000
    //   Band 4 (partial): 11,208,000 @ 21% -> 2,353,680; remaining 0
    //   Annual PAYE = 4,303,680 -> monthly PAYE = 4,303,680 / 12 = 358,640 (exact)
    // NET = 2,700,000 - 216,000 - 50,000 - 358,640 = 2,075,360
    const snapshot: EmployeeSnapshot = {
      employeeId: "ng-3",
      nationality: "NG",
      employeeType: "full_time",
      flags: { pensionOptIn: true, nhfOptIn: true },
      values: {
        BASIC: 2_000_000_00n,
        HOUSING: 500_000_00n,
        TRANSPORT: 200_000_00n,
        ANNUAL_RENT: 6_000_000_00n,
      },
    };

    const result = calculatePayslip(snapshot, NG_2026, "2026-03");

    expect(result.gross).toBe(2_700_000_00n);
    expect(result.lines.find((l) => l.code === "NHF")?.amount).toBe(50_000_00n);
    expect(result.lines.find((l) => l.code === "PAYE")?.amount).toBe(358_640_00n);
    expect(result.net).toBe(2_075_360_00n);
  });

  it("property: gross minus total deductions always equals net, across a range of employees", () => {
    const cases: EmployeeSnapshot[] = [
      {
        employeeId: "prop-1",
        nationality: "NG",
        employeeType: "full_time",
        flags: { pensionOptIn: false, nhfOptIn: false },
        values: { BASIC: 0n, HOUSING: 0n, TRANSPORT: 0n, ANNUAL_RENT: 0n },
      },
      {
        employeeId: "prop-2",
        nationality: "NG",
        employeeType: "contract",
        flags: { pensionOptIn: true, nhfOptIn: true },
        values: { BASIC: 100_000_000_00n, HOUSING: 20_000_000_00n, TRANSPORT: 5_000_000_00n, ANNUAL_RENT: 50_000_000_00n },
      },
    ];

    for (const snapshot of cases) {
      const result = calculatePayslip(snapshot, NG_2026, "2026-03");
      expect(result.net).toBe(result.gross - result.totalDeductions);
    }
  });

  it("PAYE is monotonically non-decreasing as taxable income increases", () => {
    const base = (basic: bigint): EmployeeSnapshot => ({
      employeeId: "mono",
      nationality: "NG",
      employeeType: "full_time",
      flags: { pensionOptIn: false, nhfOptIn: false },
      values: { BASIC: basic, HOUSING: 0n, TRANSPORT: 0n, ANNUAL_RENT: 0n },
    });

    const amounts = [0n, 50_000_00n, 500_000_00n, 3_000_000_00n, 60_000_000_00n];
    let previousPaye = -1n;
    for (const basic of amounts) {
      const result = calculatePayslip(base(basic), NG_2026, "2026-03");
      const paye = result.lines.find((l) => l.code === "PAYE")?.amount ?? 0n;
      expect(paye).toBeGreaterThanOrEqual(previousPaye);
      previousPaye = paye;
    }
  });
});
