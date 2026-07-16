export type MemberStatus = "active" | "dormant" | "exited";

export interface Member {
  id: string;
  orgId: string;
  membershipNumber: string;
  fullName: string;
  joinDate: string;
  status: MemberStatus;
  phone: string | null;
  email: string | null;
}

export interface NewMemberInput {
  orgId: string;
  membershipNumber: string;
  fullName: string;
  joinDate: string;
  phone?: string | null;
  email?: string | null;
}

export interface Contribution {
  id: string;
  orgId: string;
  memberId: string;
  periodYear: number;
  periodMonth: number;
  amount: bigint;
  postedAt: string;
  journalEntryId: string | null;
}

export interface ContributionInput {
  orgId: string;
  memberId: string;
  periodYear: number;
  periodMonth: number;
  amount: bigint;
}

export interface StatementLine {
  contributionId: string;
  periodYear: number;
  periodMonth: number;
  amount: bigint;
  runningBalance: bigint;
  postedAt: string;
}

export interface MemberStatement {
  member: Member;
  savingsBalance: bigint;
  lines: StatementLine[];
}

export type LoanStatus = "pending" | "approved" | "disbursed" | "active" | "repaid" | "defaulted" | "rescheduled";
export type LoanMethod = "flat" | "reducing_balance";

export interface Loan {
  id: string;
  orgId: string;
  memberId: string;
  principal: bigint;
  interestRate: number; // annual, fractional — 0.15 means 15% per annum
  tenorMonths: number;
  method: LoanMethod;
  status: LoanStatus;
  appliedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  disbursedAt: string | null;
  journalEntryId: string | null;
}

export interface LoanApplicationInput {
  orgId: string;
  memberId: string;
  principal: bigint;
  interestRate: number;
  tenorMonths: number;
  method: LoanMethod;
}

export interface EligibilityResult {
  memberId: string;
  savingsBalance: bigint;
  multiplier: number;
  outstandingPrincipal: bigint;
  guaranteedExposure: bigint;
  /** savingsBalance * multiplier - outstandingPrincipal - guaranteedExposure */
  availableToBorrow: bigint;
  requestedAmount: bigint;
  eligible: boolean;
}

export interface Guarantor {
  id: string;
  loanId: string;
  memberId: string;
  amountGuaranteed: bigint;
}

export interface GuarantorInput {
  loanId: string;
  memberId: string;
  amountGuaranteed: bigint;
}

export interface ScheduleInstallment {
  installmentNo: number;
  dueDate: string;
  principalDue: bigint;
  interestDue: bigint;
}

export interface RepaymentScheduleRow extends ScheduleInstallment {
  id: string;
  loanId: string;
  generation: number;
}

export interface Repayment {
  id: string;
  loanId: string;
  scheduleId: string | null;
  amount: bigint;
  principalPortion: bigint;
  interestPortion: bigint;
  paidAt: string;
  journalEntryId: string | null;
}

export interface ArrearsRow {
  loanId: string;
  memberId: string;
  installmentNo: number;
  dueDate: string;
  amountDue: bigint;
  daysOverdue: number;
  bucket: "current" | "30" | "60" | "90+";
}

/**
 * Serializable form of EligibilityResult for crossing the server-action
 * boundary to a client component — bigint fields stringified.
 */
export interface EligibilityCheck {
  savingsBalance: string;
  multiplier: number;
  outstandingPrincipal: string;
  guaranteedExposure: string;
  availableToBorrow: string;
  requestedAmount: string;
  eligible: boolean;
}
