import { post } from "@bp/ledger";
import type { PoolClient } from "pg";
import type {
  ArrearsRow,
  EligibilityResult,
  Guarantor,
  GuarantorInput,
  Loan,
  LoanApplicationInput,
  LoanMethod,
  Repayment,
  RepaymentScheduleRow,
  ScheduleInstallment,
} from "./types.js";

const DEFAULT_MULTIPLIER = 2.0;

// Loans in these statuses still encumber the borrower's capacity and any
// guarantor's capacity — a repaid or defaulted loan releases both.
const OUTSTANDING_LOAN_STATUSES = ["pending", "approved", "disbursed", "active"] as const;

export class LoanEligibilityError extends Error {
  constructor(
    public readonly result: EligibilityResult,
    context: string,
  ) {
    super(
      `${context}: requested ${result.requestedAmount} exceeds available capacity ${result.availableToBorrow} ` +
        `(savings ${result.savingsBalance} x ${result.multiplier} - outstanding ${result.outstandingPrincipal} - guaranteed ${result.guaranteedExposure})`,
    );
    this.name = "LoanEligibilityError";
  }
}

export class InvalidLoanStateError extends Error {
  constructor(loanId: string, expected: string, actual: string) {
    super(`loan ${loanId} must be "${expected}" for this action, is "${actual}"`);
    this.name = "InvalidLoanStateError";
  }
}

export class UnsupportedMethodError extends Error {
  constructor(method: LoanMethod) {
    super(`"${method}" amortization is not implemented yet — only "flat" is supported`);
    this.name = "UnsupportedMethodError";
  }
}

export async function getSavingsMultiplier(client: PoolClient, orgId: string): Promise<number> {
  const result = await client.query<{ savings_multiplier: string }>(
    "select savings_multiplier from society_settings where org_id = $1",
    [orgId],
  );
  return result.rows[0] ? Number(result.rows[0].savings_multiplier) : DEFAULT_MULTIPLIER;
}

export async function setSavingsMultiplier(client: PoolClient, orgId: string, multiplier: number): Promise<void> {
  await client.query(
    `insert into society_settings (org_id, savings_multiplier)
     values ($1, $2)
     on conflict (org_id) do update set savings_multiplier = excluded.savings_multiplier, updated_at = now()`,
    [orgId, multiplier],
  );
}

/** A member's savings balance, derived from the ledger — same approach as statement.ts. */
async function memberSavingsBalance(client: PoolClient, memberId: string): Promise<bigint> {
  const result = await client.query<{ total: string | null }>(
    `select -sum(jl.amount) as total
     from contributions c
     join journal_lines jl on jl.entry_id = c.journal_entry_id
     join accounts a on a.id = jl.account_id
     where c.member_id = $1 and a.code = '2100'`,
    [memberId],
  );
  return BigInt(result.rows[0]?.total ?? "0");
}

/** A member's own outstanding loan principal (disbursed minus repaid), derived from the ledger. */
async function memberOutstandingPrincipal(client: PoolClient, memberId: string): Promise<bigint> {
  const result = await client.query<{ total: string | null }>(
    `select sum(jl.amount) as total
     from loans l
     join journal_lines jl on jl.entry_id = l.journal_entry_id
     join accounts a on a.id = jl.account_id
     where l.member_id = $1 and a.code = '1100'`,
    [memberId],
  );
  const disbursed = BigInt(result.rows[0]?.total ?? "0");

  const repaidResult = await client.query<{ total: string | null }>(
    `select sum(r.principal_portion) as total
     from repayments r
     join loans l on l.id = r.loan_id
     where l.member_id = $1`,
    [memberId],
  );
  const repaid = BigInt(repaidResult.rows[0]?.total ?? "0");

  return disbursed - repaid;
}

/** Sum of amount_guaranteed across every loan (not yet repaid/defaulted) this member has guaranteed. */
async function memberGuaranteedExposure(client: PoolClient, memberId: string): Promise<bigint> {
  const result = await client.query<{ total: string | null }>(
    `select sum(g.amount_guaranteed) as total
     from guarantors g
     join loans l on l.id = g.loan_id
     where g.member_id = $1 and l.status = any($2)`,
    [memberId, OUTSTANDING_LOAN_STATUSES],
  );
  return BigInt(result.rows[0]?.total ?? "0");
}

/**
 * available_to_borrow = savings x multiplier - outstanding_loans - guaranteed_exposure
 * (the eligibility formula from .claude/skills/ajo-cooperative/SKILL.md).
 * Used both when a member applies for a loan and when a member stands as a guarantor.
 */
export async function checkEligibility(
  client: PoolClient,
  orgId: string,
  memberId: string,
  requestedAmount: bigint,
): Promise<EligibilityResult> {
  const [savingsBalance, multiplier, outstandingPrincipal, guaranteedExposure] = await Promise.all([
    memberSavingsBalance(client, memberId),
    getSavingsMultiplier(client, orgId),
    memberOutstandingPrincipal(client, memberId),
    memberGuaranteedExposure(client, memberId),
  ]);

  // multiplier is a small decimal (society bylaws, e.g. 2 or 3) — safe to
  // round to the nearest minor unit rather than carrying it through bigint
  // arithmetic.
  const capacity = BigInt(Math.round(Number(savingsBalance) * multiplier));
  const availableToBorrow = capacity - outstandingPrincipal - guaranteedExposure;

  return {
    memberId,
    savingsBalance,
    multiplier,
    outstandingPrincipal,
    guaranteedExposure,
    availableToBorrow,
    requestedAmount,
    eligible: requestedAmount <= availableToBorrow,
  };
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function addMonthsUtc(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  return date.toISOString().slice(0, 10);
}

/**
 * Flat-rate amortization: interest = principal x annualRate x (tenorMonths / 12),
 * split evenly across installments; the final installment absorbs whatever
 * residual floor-division leaves so that sum(principalDue) === principal and
 * sum(interestDue) === totalInterest, exactly — never a stray kobo.
 */
export function generateFlatSchedule(
  principal: bigint,
  annualRate: number,
  tenorMonths: number,
  disbursementDate: string,
): ScheduleInstallment[] {
  if (tenorMonths < 1) throw new RangeError("tenorMonths must be at least 1");

  const rateBps = BigInt(Math.round(annualRate * 10_000));
  const tenor = BigInt(tenorMonths);
  const totalInterest = roundHalfUp(principal * rateBps * tenor, 10_000n * 12n);

  const basePrincipal = principal / tenor;
  const baseInterest = totalInterest / tenor;

  const installments: ScheduleInstallment[] = [];
  let principalRunning = 0n;
  let interestRunning = 0n;

  for (let i = 1; i <= tenorMonths; i++) {
    const isLast = i === tenorMonths;
    const principalDue = isLast ? principal - principalRunning : basePrincipal;
    const interestDue = isLast ? totalInterest - interestRunning : baseInterest;
    principalRunning += principalDue;
    interestRunning += interestDue;

    installments.push({
      installmentNo: i,
      dueDate: addMonthsUtc(disbursementDate, i),
      principalDue,
      interestDue,
    });
  }

  return installments;
}

export async function applyForLoan(client: PoolClient, input: LoanApplicationInput): Promise<Loan> {
  if (input.method !== "flat") throw new UnsupportedMethodError(input.method);

  const eligibility = await checkEligibility(client, input.orgId, input.memberId, input.principal);
  if (!eligibility.eligible) throw new LoanEligibilityError(eligibility, "loan application rejected");

  const result = await client.query<LoanRow>(
    `insert into loans (org_id, member_id, principal, interest_rate, tenor_months, method)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [input.orgId, input.memberId, input.principal, input.interestRate, input.tenorMonths, input.method],
  );
  return toLoan(result.rows[0]!);
}

export async function addGuarantor(client: PoolClient, input: GuarantorInput): Promise<Guarantor> {
  const loan = await getLoanOrThrow(client, input.loanId);
  // A guarantor's own capacity is consumed the same way a borrower's is —
  // committing to guarantee more than you have room for is exactly the
  // over-extension the eligibility rule exists to prevent.
  const eligibility = await checkEligibility(client, loan.orgId, input.memberId, input.amountGuaranteed);
  if (!eligibility.eligible) throw new LoanEligibilityError(eligibility, "guarantor lacks capacity");

  const result = await client.query<GuarantorRow>(
    `insert into guarantors (loan_id, member_id, amount_guaranteed)
     values ($1, $2, $3)
     returning *`,
    [input.loanId, input.memberId, input.amountGuaranteed],
  );
  return toGuarantor(result.rows[0]!);
}

export async function approveLoan(client: PoolClient, loanId: string, approvedBy: string): Promise<Loan> {
  const loan = await getLoanOrThrow(client, loanId);
  if (loan.status !== "pending") throw new InvalidLoanStateError(loanId, "pending", loan.status);

  // Time has passed since application — savings, other loans, or guarantees
  // may have changed. Re-check before committing the society's money.
  const eligibility = await checkEligibility(client, loan.orgId, loan.memberId, loan.principal);
  if (!eligibility.eligible) throw new LoanEligibilityError(eligibility, "loan no longer eligible at approval time");

  const result = await client.query<LoanRow>(
    `update loans set status = 'approved', approved_by = $2, approved_at = now() where id = $1 returning *`,
    [loanId, approvedBy],
  );
  return toLoan(result.rows[0]!);
}

export async function disburseLoan(client: PoolClient, loanId: string): Promise<Loan> {
  const loan = await getLoanOrThrow(client, loanId);
  if (loan.status !== "approved") throw new InvalidLoanStateError(loanId, "approved", loan.status);
  if (loan.method !== "flat") throw new UnsupportedMethodError(loan.method);

  const disbursementDate = new Date().toISOString().slice(0, 10);
  const schedule = generateFlatSchedule(loan.principal, loan.interestRate, loan.tenorMonths, disbursementDate);

  const entry = await post(client, {
    orgId: loan.orgId,
    entryDate: disbursementDate,
    description: `Loan disbursement — loan ${loanId}`,
    source: "coop.loan_disbursement",
    sourceId: loanId,
    idempotencyKey: `coop.loan_disbursement:${loanId}`,
    lines: [
      { account: "1100", amount: loan.principal },
      { account: "1000", amount: -loan.principal },
    ],
  });

  for (const installment of schedule) {
    await client.query(
      `insert into repayment_schedules (loan_id, generation, installment_no, due_date, principal_due, interest_due)
       values ($1, 1, $2, $3, $4, $5)`,
      [loanId, installment.installmentNo, installment.dueDate, installment.principalDue, installment.interestDue],
    );
  }

  const result = await client.query<LoanRow>(
    `update loans set status = 'active', disbursed_at = now(), journal_entry_id = $2 where id = $1 returning *`,
    [loanId, entry.id],
  );
  return toLoan(result.rows[0]!);
}

export interface RepaymentInput {
  loanId: string;
}

/**
 * Pays the loan's next unpaid installment in full (partial payments aren't
 * supported yet). Posts one balanced entry: Dr Bank for the whole amount,
 * Cr Loans Receivable for the principal portion, Cr Interest Income for the
 * interest portion.
 */
export async function postRepayment(client: PoolClient, input: RepaymentInput): Promise<Repayment> {
  const loan = await getLoanOrThrow(client, input.loanId);
  if (loan.status !== "active") throw new InvalidLoanStateError(input.loanId, "active", loan.status);

  const nextResult = await client.query<RepaymentScheduleRowDb>(
    `select rs.* from repayment_schedules rs
     where rs.loan_id = $1
       and rs.generation = (select max(generation) from repayment_schedules where loan_id = $1)
       and not exists (select 1 from repayments r where r.schedule_id = rs.id)
     order by rs.installment_no
     limit 1`,
    [input.loanId],
  );
  const nextInstallment = nextResult.rows[0];
  if (!nextInstallment) throw new Error(`loan ${input.loanId} has no outstanding installments`);

  const principalPortion = BigInt(nextInstallment.principal_due);
  const interestPortion = BigInt(nextInstallment.interest_due);
  const amount = principalPortion + interestPortion;
  const paidAt = new Date().toISOString().slice(0, 10);

  const entry = await post(client, {
    orgId: loan.orgId,
    entryDate: paidAt,
    description: `Repayment — loan ${input.loanId}, installment ${nextInstallment.installment_no}`,
    source: "coop.repayment",
    sourceId: input.loanId,
    idempotencyKey: `coop.repayment:${input.loanId}:${nextInstallment.installment_no}`,
    lines: [
      { account: "1000", amount },
      { account: "1100", amount: -principalPortion },
      { account: "4100", amount: -interestPortion },
    ],
  });

  const result = await client.query<RepaymentRow>(
    `insert into repayments (loan_id, schedule_id, amount, principal_portion, interest_portion, journal_entry_id)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [input.loanId, nextInstallment.id, amount, principalPortion, interestPortion, entry.id],
  );

  const remaining = await client.query<{ count: string }>(
    `select count(*) from repayment_schedules rs
     where rs.loan_id = $1
       and rs.generation = (select max(generation) from repayment_schedules where loan_id = $1)
       and not exists (select 1 from repayments r where r.schedule_id = rs.id)`,
    [input.loanId],
  );
  if (remaining.rows[0]!.count === "0") {
    await client.query(`update loans set status = 'repaid' where id = $1`, [input.loanId]);
  }

  return toRepayment(result.rows[0]!);
}

export async function getArrearsReport(client: PoolClient, orgId: string): Promise<ArrearsRow[]> {
  const result = await client.query<{
    loan_id: string;
    member_id: string;
    installment_no: number;
    due_date: string;
    principal_due: string;
    interest_due: string;
  }>(
    `select rs.loan_id, l.member_id, rs.installment_no, rs.due_date, rs.principal_due, rs.interest_due
     from repayment_schedules rs
     join loans l on l.id = rs.loan_id
     where l.org_id = $1
       and l.status = 'active'
       and rs.generation = (select max(generation) from repayment_schedules where loan_id = rs.loan_id)
       and rs.due_date < current_date
       and not exists (select 1 from repayments r where r.schedule_id = rs.id)
     order by rs.due_date`,
    [orgId],
  );

  const today = new Date();
  return result.rows.map((row) => {
    const daysOverdue = Math.floor((today.getTime() - new Date(row.due_date).getTime()) / (1000 * 60 * 60 * 24));
    const bucket: ArrearsRow["bucket"] = daysOverdue >= 90 ? "90+" : daysOverdue >= 60 ? "60" : daysOverdue >= 30 ? "30" : "current";
    return {
      loanId: row.loan_id,
      memberId: row.member_id,
      installmentNo: row.installment_no,
      dueDate: row.due_date,
      amountDue: BigInt(row.principal_due) + BigInt(row.interest_due),
      daysOverdue,
      bucket,
    };
  });
}

export async function listLoans(client: PoolClient, orgId: string): Promise<Loan[]> {
  const result = await client.query<LoanRow>("select * from loans where org_id = $1 order by applied_at desc", [
    orgId,
  ]);
  return result.rows.map(toLoan);
}

export async function getLoan(client: PoolClient, loanId: string): Promise<Loan | null> {
  const result = await client.query<LoanRow>("select * from loans where id = $1", [loanId]);
  const row = result.rows[0];
  return row ? toLoan(row) : null;
}

async function getLoanOrThrow(client: PoolClient, loanId: string): Promise<Loan> {
  const loan = await getLoan(client, loanId);
  if (!loan) throw new Error(`loan not found: ${loanId}`);
  return loan;
}

export async function getRepaymentSchedule(client: PoolClient, loanId: string): Promise<RepaymentScheduleRow[]> {
  const result = await client.query<RepaymentScheduleRowDb>(
    `select * from repayment_schedules
     where loan_id = $1 and generation = (select max(generation) from repayment_schedules where loan_id = $1)
     order by installment_no`,
    [loanId],
  );
  return result.rows.map(toScheduleRow);
}

export async function listGuarantors(client: PoolClient, loanId: string): Promise<Guarantor[]> {
  const result = await client.query<GuarantorRow>("select * from guarantors where loan_id = $1", [loanId]);
  return result.rows.map(toGuarantor);
}

interface LoanRow {
  id: string;
  org_id: string;
  member_id: string;
  principal: string;
  interest_rate: string;
  tenor_months: number;
  method: LoanMethod;
  status: Loan["status"];
  applied_at: string;
  approved_by: string | null;
  approved_at: string | null;
  disbursed_at: string | null;
  journal_entry_id: string | null;
}

function toLoan(row: LoanRow): Loan {
  return {
    id: row.id,
    orgId: row.org_id,
    memberId: row.member_id,
    principal: BigInt(row.principal),
    interestRate: Number(row.interest_rate),
    tenorMonths: row.tenor_months,
    method: row.method,
    status: row.status,
    appliedAt: row.applied_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    disbursedAt: row.disbursed_at,
    journalEntryId: row.journal_entry_id,
  };
}

interface GuarantorRow {
  id: string;
  loan_id: string;
  member_id: string;
  amount_guaranteed: string;
}

function toGuarantor(row: GuarantorRow): Guarantor {
  return {
    id: row.id,
    loanId: row.loan_id,
    memberId: row.member_id,
    amountGuaranteed: BigInt(row.amount_guaranteed),
  };
}

interface RepaymentScheduleRowDb {
  id: string;
  loan_id: string;
  generation: number;
  installment_no: number;
  due_date: string;
  principal_due: string;
  interest_due: string;
}

function toScheduleRow(row: RepaymentScheduleRowDb): RepaymentScheduleRow {
  return {
    id: row.id,
    loanId: row.loan_id,
    generation: row.generation,
    installmentNo: row.installment_no,
    dueDate: row.due_date,
    principalDue: BigInt(row.principal_due),
    interestDue: BigInt(row.interest_due),
  };
}

interface RepaymentRow {
  id: string;
  loan_id: string;
  schedule_id: string | null;
  amount: string;
  principal_portion: string;
  interest_portion: string;
  paid_at: string;
  journal_entry_id: string | null;
}

function toRepayment(row: RepaymentRow): Repayment {
  return {
    id: row.id,
    loanId: row.loan_id,
    scheduleId: row.schedule_id,
    amount: BigInt(row.amount),
    principalPortion: BigInt(row.principal_portion),
    interestPortion: BigInt(row.interest_portion),
    paidAt: row.paid_at,
    journalEntryId: row.journal_entry_id,
  };
}
