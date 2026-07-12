/** An exact fraction, never a float — a 0.08 JS number is not exactly 8/100. */
export interface Rate {
  numerator: bigint;
  denominator: bigint;
}

export type RoundingMode = "half_up" | "half_even" | "truncate";

export type ComponentType =
  | "earning" // adds to gross, appears on the payslip
  | "deduction" // reduces net pay, appears on the payslip
  | "employer_liability" // employer cost, does not touch net pay, appears on the payslip
  | "accrual" // builds a liability over time (e.g. end-of-service), does not touch net pay
  | "relief" // reduces a later component's tax base; never a payslip line
  | "input"; // seeds a value from the employee snapshot into the context; never a payslip line

/** One band in a graduated scale. `widthMinor: null` means "and everything above" — must be the last band. */
export interface Band {
  widthMinor: bigint | null;
  rate: Rate;
}

export type CalculationMethod =
  | { method: "from_snapshot"; field: string }
  | { method: "sum_of"; codes: string[] }
  | { method: "fixed"; amount: bigint }
  | { method: "percentage_of"; base: string; rate: Rate }
  | { method: "capped_percentage"; base: string; rate: Rate; cap: bigint }
  | {
      method: "graduated_bands";
      base: string; // "GROSS" or a prior component's code
      subtract?: string[]; // prior component codes subtracted from base before banding
      annualize?: boolean; // scale base ×12 before banding, then divide the result by 12
      bands: Band[];
    };

export interface AppliesWhen {
  nationality?: string[]; // allowed nationalities; omit = any
  employeeType?: string[]; // allowed employee types; omit = any
  flag?: string; // snapshot.flags[flag] must be true
}

export interface Component {
  code: string;
  name: string;
  type: ComponentType;
  sequence: number; // components run in this order; later ones can read earlier context values
  appliesWhen?: AppliesWhen;
  calculation: CalculationMethod;
}

export interface RuleSet {
  jurisdiction: string;
  version: string; // e.g. "NG-2026-01" — this is what a payroll run pins to for reproducibility
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
  currency: string;
  roundingMode: RoundingMode;
  components: Component[];
}

/** A frozen snapshot of everything a calculation depends on. No `Date.now()`, no "current" anything. */
export interface EmployeeSnapshot {
  employeeId: string;
  nationality: string;
  employeeType: string;
  flags: Record<string, boolean>;
  values: Record<string, bigint>; // minor units, e.g. { BASIC: 30000000n, ANNUAL_RENT: 0n }
}

export interface PayslipLine {
  code: string;
  name: string;
  type: ComponentType;
  amount: bigint;
}

export interface PayslipResult {
  employeeId: string;
  period: string;
  ruleSetVersion: string;
  gross: bigint;
  totalDeductions: bigint;
  totalEmployerLiabilities: bigint;
  net: bigint;
  lines: PayslipLine[];
}
