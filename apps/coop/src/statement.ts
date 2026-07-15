import type { PoolClient } from "pg";
import { getMember } from "./members.js";
import type { MemberStatement, StatementLine } from "./types.js";

interface StatementRow {
  contribution_id: string;
  period_year: number;
  period_month: number;
  amount: string;
  posted_at: string;
}

/**
 * A member's savings balance and transaction history — derived entirely
 * from the ledger (contributions joined through to their journal_lines
 * against 2100 Member Savings), never a stored column. The moment that
 * balance is cached, it drifts, and a member will find the discrepancy
 * before we do.
 */
export async function getMemberStatement(
  client: PoolClient,
  orgId: string,
  memberId: string,
): Promise<MemberStatement | null> {
  const member = await getMember(client, orgId, memberId);
  if (!member) return null;

  const result = await client.query<StatementRow>(
    `select c.id as contribution_id, c.period_year, c.period_month, -jl.amount as amount, c.posted_at
     from contributions c
     join journal_lines jl on jl.entry_id = c.journal_entry_id
     join accounts a on a.id = jl.account_id
     where c.member_id = $1 and a.code = '2100'
     order by c.period_year, c.period_month`,
    [memberId],
  );

  let runningBalance = 0n;
  const lines: StatementLine[] = result.rows.map((row) => {
    const amount = BigInt(row.amount);
    runningBalance += amount;
    return {
      contributionId: row.contribution_id,
      periodYear: row.period_year,
      periodMonth: row.period_month,
      amount,
      runningBalance,
      postedAt: row.posted_at,
    };
  });

  return { member, savingsBalance: runningBalance, lines };
}
