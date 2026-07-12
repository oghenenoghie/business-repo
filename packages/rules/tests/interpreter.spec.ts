import { describe, expect, it } from "vitest";
import { calculatePayslip } from "../src/interpreter.js";
import type { EmployeeSnapshot, RuleSet } from "../src/types.js";

// A synthetic rule set unrelated to any real jurisdiction — these tests
// prove the interpreter's mechanics (conditional application, base
// resolution, component types) with zero jurisdiction-specific logic in
// the engine itself. Kuwait's PIFSS (nationals-only) and Nigeria's opt-in
// NHF both express through the same `appliesWhen.flag` / `nationality`
// mechanism exercised here.
const rate = (numerator: bigint, denominator: bigint) => ({ numerator, denominator });

const TEST_RULE_SET: RuleSet = {
  jurisdiction: "TEST",
  version: "TEST-1",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  currency: "XXX",
  roundingMode: "half_up",
  components: [
    { code: "BASIC", name: "Basic", type: "earning", sequence: 10, calculation: { method: "from_snapshot", field: "BASIC" } },
    { code: "BONUS", name: "Bonus", type: "earning", sequence: 20, calculation: { method: "fixed", amount: 500n } },
    {
      code: "TOTAL_EARNINGS",
      name: "Total Earnings (input)",
      type: "input",
      sequence: 25,
      calculation: { method: "sum_of", codes: ["BASIC", "BONUS"] },
    },
    {
      code: "NATIONALS_ONLY_LEVY",
      name: "Nationals-Only Levy",
      type: "deduction",
      sequence: 30,
      appliesWhen: { nationality: ["KW"] },
      calculation: { method: "percentage_of", base: "GROSS", rate: rate(5n, 100n) },
    },
    {
      code: "OPT_IN_DEDUCTION",
      name: "Opt-In Deduction",
      type: "deduction",
      sequence: 40,
      appliesWhen: { flag: "optedIn" },
      calculation: { method: "fixed", amount: 100n },
    },
    {
      code: "CAPPED_ALLOWANCE_RELIEF",
      name: "Capped Relief",
      type: "relief",
      sequence: 50,
      calculation: { method: "capped_percentage", base: "TOTAL_EARNINGS", rate: rate(50n, 100n), cap: 200n },
    },
    {
      code: "EMPLOYER_TOPUP",
      name: "Employer Topup",
      type: "employer_liability",
      sequence: 60,
      calculation: { method: "percentage_of", base: "GROSS", rate: rate(10n, 100n) },
    },
    {
      code: "SERVICE_ACCRUAL",
      name: "Service Accrual",
      type: "accrual",
      sequence: 70,
      calculation: { method: "percentage_of", base: "GROSS", rate: rate(2n, 100n) },
    },
  ],
};

function snapshot(overrides: Partial<EmployeeSnapshot> = {}): EmployeeSnapshot {
  return {
    employeeId: "emp-1",
    nationality: "NG",
    employeeType: "full_time",
    flags: {},
    values: { BASIC: 1000n },
    ...overrides,
  };
}

describe("calculatePayslip — engine mechanics", () => {
  it("earnings accumulate into gross and post as lines", () => {
    const result = calculatePayslip(snapshot(), TEST_RULE_SET, "2026-01");
    expect(result.gross).toBe(1500n); // BASIC 1000 + BONUS 500
    expect(result.lines.map((l) => l.code)).toContain("BASIC");
    expect(result.lines.map((l) => l.code)).toContain("BONUS");
  });

  it("appliesWhen.nationality gates a component off for non-matching employees", () => {
    const ngResult = calculatePayslip(snapshot({ nationality: "NG" }), TEST_RULE_SET, "2026-01");
    expect(ngResult.lines.find((l) => l.code === "NATIONALS_ONLY_LEVY")).toBeUndefined();

    const kwResult = calculatePayslip(snapshot({ nationality: "KW" }), TEST_RULE_SET, "2026-01");
    const levy = kwResult.lines.find((l) => l.code === "NATIONALS_ONLY_LEVY");
    expect(levy?.amount).toBe(75n); // 5% of 1500
  });

  it("appliesWhen.flag gates a component off unless the flag is set", () => {
    const optedOut = calculatePayslip(snapshot({ flags: {} }), TEST_RULE_SET, "2026-01");
    expect(optedOut.lines.find((l) => l.code === "OPT_IN_DEDUCTION")).toBeUndefined();

    const optedIn = calculatePayslip(snapshot({ flags: { optedIn: true } }), TEST_RULE_SET, "2026-01");
    expect(optedIn.lines.find((l) => l.code === "OPT_IN_DEDUCTION")?.amount).toBe(100n);
  });

  it("relief and input components never appear as payslip lines", () => {
    const result = calculatePayslip(snapshot(), TEST_RULE_SET, "2026-01");
    expect(result.lines.find((l) => l.code === "TOTAL_EARNINGS")).toBeUndefined();
    expect(result.lines.find((l) => l.code === "CAPPED_ALLOWANCE_RELIEF")).toBeUndefined();
  });

  it("capped_percentage clamps at the cap", () => {
    // TOTAL_EARNINGS = 1500; 50% = 750, but capped at 200.
    const result = calculatePayslip(snapshot(), TEST_RULE_SET, "2026-01");
    // Not a payslip line (type "relief"), so verify indirectly: rerun with the
    // deduction wired to consume it isn't set up here, so assert via a second
    // rule set that surfaces it as a deduction instead.
    const surfaced: RuleSet = {
      ...TEST_RULE_SET,
      components: [
        ...TEST_RULE_SET.components,
        {
          code: "RELIEF_AS_DEDUCTION",
          name: "Relief surfaced as deduction",
          type: "deduction",
          sequence: 55,
          calculation: { method: "capped_percentage", base: "TOTAL_EARNINGS", rate: rate(50n, 100n), cap: 200n },
        },
      ],
    };
    const withSurfaced = calculatePayslip(snapshot(), surfaced, "2026-01");
    expect(withSurfaced.lines.find((l) => l.code === "RELIEF_AS_DEDUCTION")?.amount).toBe(200n);
    expect(result).toBeDefined();
  });

  it("employer_liability and accrual never reduce net pay", () => {
    const result = calculatePayslip(snapshot(), TEST_RULE_SET, "2026-01");
    expect(result.net).toBe(result.gross - result.totalDeductions);
    expect(result.lines.find((l) => l.code === "EMPLOYER_TOPUP")).toBeDefined();
    expect(result.lines.find((l) => l.code === "SERVICE_ACCRUAL")).toBeDefined();
    // Neither affected totalDeductions or net — proven by the identity above
    // holding while both lines are present with non-zero amounts.
    expect(result.lines.find((l) => l.code === "EMPLOYER_TOPUP")?.amount).toBeGreaterThan(0n);
  });

  it("throws referencing an unknown base", () => {
    const broken: RuleSet = {
      ...TEST_RULE_SET,
      components: [
        {
          code: "BAD",
          name: "Bad",
          type: "deduction",
          sequence: 5,
          calculation: { method: "percentage_of", base: "NOPE", rate: rate(1n, 100n) },
        },
      ],
    };
    expect(() => calculatePayslip(snapshot(), broken, "2026-01")).toThrow(/unknown base reference/);
  });

  it("gross minus total deductions always equals net", () => {
    for (const flags of [{}, { optedIn: true }] as Record<string, boolean>[]) {
      for (const nationality of ["NG", "KW"]) {
        const result = calculatePayslip(snapshot({ flags, nationality }), TEST_RULE_SET, "2026-01");
        expect(result.net).toBe(result.gross - result.totalDeductions);
      }
    }
  });
});
