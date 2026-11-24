import { post } from "@bp/ledger";
import type { PoolClient } from "pg";
import type { InterestAccrualRun } from "./types.js";

/**
 * Recognizes interest income early (Dr Interest Receivable / Cr Interest
 * Income) for installments that have come due on or before `asOfDate` but
 * haven't been repaid — moving them from "recognized on payment" (cash
 * basis) to "recognized when earned" (accrual basis). Marks each processed
 * installment's `accrued_at` so postRepayment() later credits the
 * receivable instead of booking the same income twice.
 *
 * Idempotent: a rerun for the same org and date finds nothing left to
 * accrue (already-marked installments are excluded), so it returns null
 * without posting anything.
 */
export async function runInterestAccrual(
  client: PoolClient,
  orgId: string,
  asOfDate: string,
): Promise<InterestAccrualRun | null> {
  const dueResult = await client.query<{ id: string; interest_due: string }>(
    `select rs.id, rs.interest_due
     from repayment_schedules rs
     join loans l on l.id = rs.loan_id
     where l.org_id = $1
       and l.status = 'active'
       and rs.generation = (select max(generation) from repayment_schedules where loan_id = rs.loan_id)
       and rs.due_date <= $2
       and rs.accrued_at is null
       and not exists (select 1 from repayments r where r.schedule_id = rs.id)`,
    [orgId, asOfDate],
  );
  if (dueResult.rows.length === 0) return null;

  const amount = dueResult.rows.reduce((sum, row) => sum + BigInt(row.interest_due), 0n);
  if (amount === 0n) return null;

  const entry = await post(client, {
    orgId,
    entryDate: asOfDate,
    description: `Interest accrual through ${asOfDate}`,
    source: "coop.interest_accrual",
    idempotencyKey: `coop.interest_accrual:${orgId}:${asOfDate}`,
    lines: [
      { account: "1150", amount },
      { account: "4100", amount: -amount },
    ],
  });

  const scheduleIds = dueResult.rows.map((row) => row.id);
  await client.query(`update repayment_schedules set accrued_at = now() where id = any($1)`, [scheduleIds]);

  const runResult = await client.query<{ id: string }>(
    `insert into interest_accrual_runs (org_id, run_date, amount, journal_entry_id)
     values ($1, $2, $3, $4)
     returning id`,
    [orgId, asOfDate, amount, entry.id],
  );

  return {
    id: runResult.rows[0]!.id,
    orgId,
    runDate: asOfDate,
    amount,
    journalEntryId: entry.id,
  };
}

export async function listInterestAccrualRuns(client: PoolClient, orgId: string): Promise<InterestAccrualRun[]> {
  const result = await client.query<{
    id: string;
    run_date: string | Date;
    amount: string;
    journal_entry_id: string | null;
  }>(
    "select id, run_date, amount, journal_entry_id from interest_accrual_runs where org_id = $1 order by run_date desc",
    [orgId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    orgId,
    runDate: toDateString(row.run_date),
    amount: BigInt(row.amount),
    journalEntryId: row.journal_entry_id,
  }));
}

function toDateString(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}
