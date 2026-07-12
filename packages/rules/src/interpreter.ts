import { evaluateAppliesWhen } from "./appliesWhen.js";
import { roundDivide } from "./rounding.js";
import type {
  Band,
  CalculationMethod,
  Component,
  EmployeeSnapshot,
  PayslipLine,
  PayslipResult,
  RoundingMode,
  RuleSet,
} from "./types.js";

class UnknownBaseError extends Error {
  constructor(base: string) {
    super(`unknown base reference: ${base} (must be "GROSS" or a component code with an earlier sequence number)`);
    this.name = "UnknownBaseError";
  }
}

function resolveBase(base: string, context: Record<string, bigint>, gross: bigint): bigint {
  if (base === "GROSS") return gross;
  const value = context[base];
  if (value === undefined) throw new UnknownBaseError(base);
  return value;
}

function applyBands(base: bigint, bands: Band[], annualize: boolean | undefined, roundingMode: RoundingMode): bigint {
  const scale = annualize ? 12n : 1n;
  let remaining = base * scale;
  let tax = 0n;

  for (const band of bands) {
    if (remaining <= 0n) break;
    const width = band.widthMinor ?? remaining;
    const portion = remaining < width ? remaining : width;
    if (portion > 0n) tax += roundDivide(portion * band.rate.numerator, band.rate.denominator, roundingMode);
    remaining -= portion;
  }

  return annualize ? roundDivide(tax, scale, roundingMode) : tax;
}

function resolveAmount(
  calculation: CalculationMethod,
  context: Record<string, bigint>,
  snapshot: EmployeeSnapshot,
  gross: bigint,
  roundingMode: RoundingMode,
): bigint {
  switch (calculation.method) {
    case "from_snapshot":
      return snapshot.values[calculation.field] ?? 0n;

    case "sum_of":
      return calculation.codes.reduce((sum, code) => sum + (context[code] ?? 0n), 0n);

    case "fixed":
      return calculation.amount;

    case "percentage_of": {
      const base = resolveBase(calculation.base, context, gross);
      return roundDivide(base * calculation.rate.numerator, calculation.rate.denominator, roundingMode);
    }

    case "capped_percentage": {
      const base = resolveBase(calculation.base, context, gross);
      const raw = roundDivide(base * calculation.rate.numerator, calculation.rate.denominator, roundingMode);
      return raw > calculation.cap ? calculation.cap : raw;
    }

    case "graduated_bands": {
      let base = resolveBase(calculation.base, context, gross);
      for (const code of calculation.subtract ?? []) {
        base -= context[code] ?? 0n;
      }
      if (base < 0n) base = 0n;
      return applyBands(base, calculation.bands, calculation.annualize, roundingMode);
    }
  }
}

/**
 * The pure function at the center of the package: `(snapshot, ruleSet, period) → Payslip`.
 * No `Date.now()`, no I/O, no jurisdiction-specific branching — everything
 * that varies between Nigeria and Kuwait (or any future jurisdiction) is
 * data in the RuleSet, not code here.
 */
export function calculatePayslip(snapshot: EmployeeSnapshot, ruleSet: RuleSet, period: string): PayslipResult {
  const context: Record<string, bigint> = {};
  const lines: PayslipLine[] = [];
  let gross = 0n;
  let totalDeductions = 0n;
  let totalEmployerLiabilities = 0n;

  const ordered = [...ruleSet.components].sort((a, b) => a.sequence - b.sequence);

  for (const component of ordered) {
    const applies = evaluateAppliesWhen(component.appliesWhen, snapshot);
    const amount = applies ? resolveAmount(component.calculation, context, snapshot, gross, ruleSet.roundingMode) : 0n;
    context[component.code] = amount;

    if (!applies) continue; // gated off entirely: no line, no effect on gross/deductions/liabilities

    switch (component.type) {
      case "earning":
        gross += amount;
        lines.push(toLine(component, amount));
        break;
      case "deduction":
        totalDeductions += amount;
        lines.push(toLine(component, amount));
        break;
      case "employer_liability":
        totalEmployerLiabilities += amount;
        lines.push(toLine(component, amount));
        break;
      case "accrual":
        lines.push(toLine(component, amount));
        break;
      case "relief":
      case "input":
        break; // context only — never a payslip line, never touches gross/net
    }
  }

  return {
    employeeId: snapshot.employeeId,
    period,
    ruleSetVersion: ruleSet.version,
    gross,
    totalDeductions,
    totalEmployerLiabilities,
    net: gross - totalDeductions,
    lines,
  };
}

function toLine(component: Component, amount: bigint): PayslipLine {
  return { code: component.code, name: component.name, type: component.type, amount };
}
