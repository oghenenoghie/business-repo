import type { PoolClient } from "pg";
import { toBigInt } from "@bp/ledger";
import type { Employee, EmploymentRecord, EmploymentRecordInput, NewEmployeeInput } from "./types.js";

export async function createEmployee(client: PoolClient, input: NewEmployeeInput): Promise<Employee> {
  const result = await client.query<{
    id: string;
    org_id: string;
    staff_number: string;
    full_name: string;
    nationality: string;
    employee_type: string;
    pension_opt_in: boolean;
    nhf_opt_in: boolean;
    hire_date: string;
    termination_date: string | null;
  }>(
    `insert into employees
       (org_id, staff_number, full_name, nationality, employee_type, pension_opt_in, nhf_opt_in, hire_date, termination_date)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [
      input.orgId,
      input.staffNumber,
      input.fullName,
      input.nationality,
      input.employeeType ?? "full_time",
      input.pensionOptIn ?? true,
      input.nhfOptIn ?? false,
      input.hireDate,
      input.terminationDate ?? null,
    ],
  );
  return toEmployee(result.rows[0]!);
}

/** Employment records are effective-dated and append-only — a raise is a new row, never an UPDATE. */
export async function addEmploymentRecord(
  client: PoolClient,
  orgId: string,
  employeeId: string,
  input: EmploymentRecordInput,
): Promise<EmploymentRecord> {
  const result = await client.query<{
    id: string;
    employee_id: string;
    effective_from: string;
    basic: string;
    housing: string;
    transport: string;
    annual_rent: string;
    currency: string;
  }>(
    `insert into employment_records (org_id, employee_id, effective_from, basic, housing, transport, annual_rent, currency)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning *`,
    [
      orgId,
      employeeId,
      input.effectiveFrom,
      input.basic,
      input.housing ?? 0n,
      input.transport ?? 0n,
      input.annualRent ?? 0n,
      input.currency,
    ],
  );
  return toEmploymentRecord(result.rows[0]!);
}

/** The employment record effective for a given date — the latest one with effective_from <= asOf. */
export async function resolveEmploymentRecord(
  client: PoolClient,
  employeeId: string,
  asOf: string,
): Promise<EmploymentRecord | null> {
  const result = await client.query<{
    id: string;
    employee_id: string;
    effective_from: string;
    basic: string;
    housing: string;
    transport: string;
    annual_rent: string;
    currency: string;
  }>(
    `select * from employment_records
     where employee_id = $1 and effective_from <= $2
     order by effective_from desc
     limit 1`,
    [employeeId, asOf],
  );
  const row = result.rows[0];
  return row ? toEmploymentRecord(row) : null;
}

/** Employees active during `period` (hired on/before the period end, not yet terminated as of the period start). */
export async function listActiveEmployees(client: PoolClient, orgId: string, periodStart: string, periodEnd: string): Promise<Employee[]> {
  const result = await client.query<{
    id: string;
    org_id: string;
    staff_number: string;
    full_name: string;
    nationality: string;
    employee_type: string;
    pension_opt_in: boolean;
    nhf_opt_in: boolean;
    hire_date: string;
    termination_date: string | null;
  }>(
    `select * from employees
     where org_id = $1
       and hire_date <= $2
       and (termination_date is null or termination_date >= $3)
     order by staff_number`,
    [orgId, periodEnd, periodStart],
  );
  return result.rows.map(toEmployee);
}

function toEmployee(row: {
  id: string;
  org_id: string;
  staff_number: string;
  full_name: string;
  nationality: string;
  employee_type: string;
  pension_opt_in: boolean;
  nhf_opt_in: boolean;
  hire_date: string;
  termination_date: string | null;
}): Employee {
  return {
    id: row.id,
    orgId: row.org_id,
    staffNumber: row.staff_number,
    fullName: row.full_name,
    nationality: row.nationality,
    employeeType: row.employee_type,
    pensionOptIn: row.pension_opt_in,
    nhfOptIn: row.nhf_opt_in,
    hireDate: row.hire_date,
    terminationDate: row.termination_date,
  };
}

function toEmploymentRecord(row: {
  id: string;
  employee_id: string;
  effective_from: string;
  basic: string;
  housing: string;
  transport: string;
  annual_rent: string;
  currency: string;
}): EmploymentRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    effectiveFrom: row.effective_from,
    basic: toBigInt(row.basic),
    housing: toBigInt(row.housing),
    transport: toBigInt(row.transport),
    annualRent: toBigInt(row.annual_rent),
    currency: row.currency,
  };
}
