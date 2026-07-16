import { post } from "@bp/ledger";
import type { PoolClient } from "pg";
import type {
  DividendAllocation,
  DividendBasis,
  DividendRun,
  DividendRunStatus,
  NewDividendRunInput,
} from "./types.js";

export class UnsupportedDividendBasisError extends Error {
  constructor(basis: DividendBasis) {
    super(`"${basis}" dividend basis is not implemented yet — only "savings" is supported`);
    this.name = "UnsupportedDividendBasisError";
  }
}

export class InvalidDividendRunStateError extends Error {
  constructor(runId: string, expected: string, actual: string) {
    super(`dividend run ${runId} must be "${expected}" for this action, is "${actual}"`);
    this.name = "InvalidDividendRunStateError";
  }
}

/** Should never fire — a bug-detector, not a business rule. */
export class DividendReconciliationError extends Error {
  constructor(allocated: bigint, surplus: bigint) {
    super(`dividend allocations sum to ${allocated}, expected exactly ${surplus}`);
    this.name = "DividendReconciliationError";
  }
}

export async function createDividendRun(client: PoolClient, input: NewDividendRunInput): Promise<DividendRun> {
  if (input.distributableSurplus < 0n) throw new RangeError("distributableSurplus must not be negative");

  const result = await client.query<DividendRunRow>(
    `insert into dividend_runs (org_id, financial_year, distributable_surplus, basis)
     values ($1, $2, $3, $4)
     returning *`,
    [input.orgId, input.financialYear, input.distributableSurplus, input.basis],
  );
  return toDividendRun(result.rows[0]!);
}

/** Each member's basis amount for pro-rata allocation. Only "savings" is implemented so far. */
async function memberBasisAmounts(
  client: PoolClient,
  orgId: string,
  basis: DividendBasis,
): Promise<Array<{ memberId: string; basisAmount: bigint }>> {
  if (basis !== "savings") throw new UnsupportedDividendBasisError(basis);

  // Same "derive from the ledger, never a stored column" approach as
  // memberSavingsBalance() in loans.ts, computed for every member at once.
  const result = await client.query<{ member_id: string; total: string }>(
    `select m.id as member_id, coalesce(bal.total, 0) as total
     from members m
     left join (
       select c.member_id, -sum(jl.amount) as total
       from contributions c
       join journal_lines jl on jl.entry_id = c.journal_entry_id
       join accounts a on a.id = jl.account_id
       where a.code = '2100'
       group by c.member_id
     ) bal on bal.member_id = m.id
     where m.org_id = $1 and coalesce(bal.total, 0) > 0`,
    [orgId],
  );
  return result.rows.map((row) => ({ memberId: row.member_id, basisAmount: BigInt(row.total) }));
}

/**
 * allocated_i = floor(surplus * basis_i / total_basis), then the leftover
 * minor units (always fewer than the number of members) go one each to the
 * members with the largest fractional remainder — the largest-remainder
 * method — so sum(allocated) === surplus exactly, never approximately.
 */
export async function allocateDividends(client: PoolClient, runId: string): Promise<DividendAllocation[]> {
  const run = await getDividendRunOrThrow(client, runId);
  if (run.status !== "draft") throw new InvalidDividendRunStateError(runId, "draft", run.status);

  const basisRows = await memberBasisAmounts(client, run.orgId, run.basis);
  const totalBasis = basisRows.reduce((sum, r) => sum + r.basisAmount, 0n);
  if (totalBasis === 0n) throw new Error(`no member has a positive ${run.basis} basis to allocate against`);

  const surplus = run.distributableSurplus;
  const rows = basisRows.map((r) => {
    const numerator = surplus * r.basisAmount;
    return {
      memberId: r.memberId,
      basisAmount: r.basisAmount,
      floorAllocated: numerator / totalBasis,
      remainder: numerator % totalBasis,
    };
  });

  const allocated = new Map(rows.map((r) => [r.memberId, r.floorAllocated]));
  let remaining = surplus - rows.reduce((sum, r) => sum + r.floorAllocated, 0n);

  const byRemainderDesc = [...rows].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0;
  });
  for (let i = 0; i < byRemainderDesc.length && remaining > 0n; i++) {
    const memberId = byRemainderDesc[i]!.memberId;
    allocated.set(memberId, allocated.get(memberId)! + 1n);
    remaining -= 1n;
  }

  const totalAllocated = [...allocated.values()].reduce((sum, v) => sum + v, 0n);
  if (totalAllocated !== surplus) throw new DividendReconciliationError(totalAllocated, surplus);

  const inserted: DividendAllocation[] = [];
  for (const r of rows) {
    const result = await client.query<DividendAllocationRow>(
      `insert into dividend_allocations (run_id, member_id, basis_amount, allocated)
       values ($1, $2, $3, $4)
       returning *`,
      [runId, r.memberId, r.basisAmount, allocated.get(r.memberId)!],
    );
    inserted.push(toDividendAllocation(result.rows[0]!));
  }

  await client.query(`update dividend_runs set status = 'allocated' where id = $1`, [runId]);

  return inserted;
}

export async function approveDividendRun(client: PoolClient, runId: string, approvedBy: string): Promise<DividendRun> {
  const run = await getDividendRunOrThrow(client, runId);
  if (run.status !== "allocated") throw new InvalidDividendRunStateError(runId, "allocated", run.status);

  const result = await client.query<DividendRunRow>(
    `update dividend_runs set status = 'approved', approved_by = $2, approved_at = now() where id = $1 returning *`,
    [runId, approvedBy],
  );
  return toDividendRun(result.rows[0]!);
}

/** Posts Dr Dividends (expense) / Cr Dividends Payable for the run's total surplus. */
export async function postDividendRun(client: PoolClient, runId: string): Promise<DividendRun> {
  const run = await getDividendRunOrThrow(client, runId);
  if (run.status !== "approved") throw new InvalidDividendRunStateError(runId, "approved", run.status);

  const entryDate = new Date().toISOString().slice(0, 10);
  const entry = await post(client, {
    orgId: run.orgId,
    entryDate,
    description: `Dividend declared — FY${run.financialYear}`,
    source: "coop.dividend_run",
    sourceId: runId,
    idempotencyKey: `coop.dividend_run:${runId}`,
    lines: [
      { account: "6100", amount: run.distributableSurplus },
      { account: "2150", amount: -run.distributableSurplus },
    ],
  });

  const result = await client.query<DividendRunRow>(
    `update dividend_runs set status = 'posted', journal_entry_id = $2 where id = $1 returning *`,
    [runId, entry.id],
  );
  return toDividendRun(result.rows[0]!);
}

export async function listDividendRuns(client: PoolClient, orgId: string): Promise<DividendRun[]> {
  const result = await client.query<DividendRunRow>(
    "select * from dividend_runs where org_id = $1 order by financial_year desc",
    [orgId],
  );
  return result.rows.map(toDividendRun);
}

export async function getDividendRun(client: PoolClient, runId: string): Promise<DividendRun | null> {
  const result = await client.query<DividendRunRow>("select * from dividend_runs where id = $1", [runId]);
  const row = result.rows[0];
  return row ? toDividendRun(row) : null;
}

async function getDividendRunOrThrow(client: PoolClient, runId: string): Promise<DividendRun> {
  const run = await getDividendRun(client, runId);
  if (!run) throw new Error(`dividend run not found: ${runId}`);
  return run;
}

export async function getDividendAllocations(client: PoolClient, runId: string): Promise<DividendAllocation[]> {
  const result = await client.query<DividendAllocationRow>(
    "select * from dividend_allocations where run_id = $1 order by allocated desc",
    [runId],
  );
  return result.rows.map(toDividendAllocation);
}

interface DividendRunRow {
  id: string;
  org_id: string;
  financial_year: number;
  distributable_surplus: string;
  basis: DividendBasis;
  status: DividendRunStatus;
  journal_entry_id: string | null;
  approved_by: string | null;
  approved_at: string | Date | null;
}

function toDividendRun(row: DividendRunRow): DividendRun {
  return {
    id: row.id,
    orgId: row.org_id,
    financialYear: row.financial_year,
    distributableSurplus: BigInt(row.distributable_surplus),
    basis: row.basis,
    status: row.status,
    journalEntryId: row.journal_entry_id,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at === null ? null : toTimestampString(row.approved_at),
  };
}

interface DividendAllocationRow {
  id: string;
  run_id: string;
  member_id: string;
  basis_amount: string;
  allocated: string;
}

function toDividendAllocation(row: DividendAllocationRow): DividendAllocation {
  return {
    id: row.id,
    runId: row.run_id,
    memberId: row.member_id,
    basisAmount: BigInt(row.basis_amount),
    allocated: BigInt(row.allocated),
  };
}

function toTimestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
