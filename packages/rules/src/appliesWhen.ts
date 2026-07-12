import type { AppliesWhen, EmployeeSnapshot } from "./types.js";

/**
 * The one piece of conditional logic the whole engine needs: whether a
 * component applies to this employee. Kuwait's PIFSS (nationals only) and
 * Nigeria's opt-in NHF both express through this — no jurisdiction-specific
 * branching in the interpreter itself.
 */
export function evaluateAppliesWhen(appliesWhen: AppliesWhen | undefined, snapshot: EmployeeSnapshot): boolean {
  if (!appliesWhen) return true;
  if (appliesWhen.nationality && !appliesWhen.nationality.includes(snapshot.nationality)) return false;
  if (appliesWhen.employeeType && !appliesWhen.employeeType.includes(snapshot.employeeType)) return false;
  if (appliesWhen.flag && !snapshot.flags[appliesWhen.flag]) return false;
  return true;
}
