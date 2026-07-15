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
