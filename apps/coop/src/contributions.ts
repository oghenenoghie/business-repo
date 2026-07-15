import { post } from "@bp/ledger";
import type { PoolClient } from "pg";
import type { Contribution, ContributionInput } from "./types.js";

interface ContributionRow {
  id: string;
  org_id: string;
  member_id: string;
  period_year: number;
  period_month: number;
  amount: string;
  posted_at: string;
  journal_entry_id: string | null;
}

export class ContributionAlreadyPostedError extends Error {
  constructor(memberId: string, periodYear: number, periodMonth: number) {
    super(`contribution already posted for member ${memberId}, period ${periodYear}-${periodMonth}`);
    this.name = "ContributionAlreadyPostedError";
  }
}

/**
 * Posts a member's monthly contribution: Dr 1000 Bank, Cr 2100 Member
 * Savings. The `contributions` row and the ledger entry are written in the
 * same call so they can never drift — the member's savings balance is
 * derived entirely from this posting, never stored as a column.
 */
export async function postContribution(client: PoolClient, input: ContributionInput): Promise<Contribution> {
  const existing = await client.query<{ id: string }>(
    "select id from contributions where member_id = $1 and period_year = $2 and period_month = $3",
    [input.memberId, input.periodYear, input.periodMonth],
  );
  if (existing.rows[0]) {
    throw new ContributionAlreadyPostedError(input.memberId, input.periodYear, input.periodMonth);
  }

  const period = `${input.periodYear}-${String(input.periodMonth).padStart(2, "0")}`;
  const entry = await post(client, {
    orgId: input.orgId,
    entryDate: `${period}-01`,
    description: `Member contribution ${period}`,
    source: "coop.contribution",
    sourceId: input.memberId,
    idempotencyKey: `coop.contribution:${input.memberId}:${period}`,
    lines: [
      { account: "1000", amount: input.amount },
      { account: "2100", amount: -input.amount },
    ],
  });

  const result = await client.query<ContributionRow>(
    `insert into contributions (org_id, member_id, period_year, period_month, amount, journal_entry_id)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [input.orgId, input.memberId, input.periodYear, input.periodMonth, input.amount, entry.id],
  );
  return toContribution(result.rows[0]!);
}

export async function listContributions(client: PoolClient, orgId: string, memberId: string): Promise<Contribution[]> {
  const result = await client.query<ContributionRow>(
    `select * from contributions where org_id = $1 and member_id = $2 order by period_year, period_month`,
    [orgId, memberId],
  );
  return result.rows.map(toContribution);
}

function toContribution(row: ContributionRow): Contribution {
  return {
    id: row.id,
    orgId: row.org_id,
    memberId: row.member_id,
    periodYear: row.period_year,
    periodMonth: row.period_month,
    amount: BigInt(row.amount),
    postedAt: row.posted_at,
    journalEntryId: row.journal_entry_id,
  };
}
