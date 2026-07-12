export interface Employee {
  id: string;
  orgId: string;
  staffNumber: string;
  fullName: string;
  nationality: string;
  employeeType: string;
  pensionOptIn: boolean;
  nhfOptIn: boolean;
  hireDate: string;
  terminationDate: string | null;
}

export interface NewEmployeeInput {
  orgId: string;
  staffNumber: string;
  fullName: string;
  nationality: string;
  employeeType?: string;
  pensionOptIn?: boolean;
  nhfOptIn?: boolean;
  hireDate: string;
  terminationDate?: string | null;
}

export interface EmploymentRecordInput {
  effectiveFrom: string; // YYYY-MM-DD
  basic: bigint;
  housing?: bigint;
  transport?: bigint;
  annualRent?: bigint;
  currency: string;
}

export interface EmploymentRecord {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  basic: bigint;
  housing: bigint;
  transport: bigint;
  annualRent: bigint;
  currency: string;
}

export type PayrollRunStatus = "draft" | "calculated" | "approved" | "posted";

export interface PayrollRun {
  id: string;
  orgId: string;
  period: string; // YYYY-MM
  jurisdiction: string;
  ruleSetVersion: string;
  status: PayrollRunStatus;
  journalEntryId: string | null;
}
