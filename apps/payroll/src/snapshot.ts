import type { EmployeeSnapshot } from "@bp/rules";
import type { PoolClient } from "pg";
import { resolveEmploymentRecord } from "./employees.js";
import type { Employee } from "./types.js";

/** Builds the frozen snapshot packages/rules calculates against — the employment record effective as of `periodStart`. */
export async function buildSnapshot(client: PoolClient, employee: Employee, periodStart: string): Promise<EmployeeSnapshot> {
  const record = await resolveEmploymentRecord(client, employee.id, periodStart);
  if (!record) {
    throw new Error(`no employment record effective on or before ${periodStart} for employee ${employee.id}`);
  }

  return {
    employeeId: employee.id,
    nationality: employee.nationality,
    employeeType: employee.employeeType,
    flags: {
      pensionOptIn: employee.pensionOptIn,
      nhfOptIn: employee.nhfOptIn,
    },
    values: {
      BASIC: record.basic,
      HOUSING: record.housing,
      TRANSPORT: record.transport,
      ANNUAL_RENT: record.annualRent,
    },
  };
}
