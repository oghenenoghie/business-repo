import type { PoolClient } from "pg";
import { toBigInt } from "./money.js";

export interface PostLineInput {
  /** Account code within the org's chart of accounts, e.g. "6000". */
  account: string;
  /** Minor units. Debits positive, credits negative. Must sum to 0n across all lines. */
  amount: bigint;
  memo?: string;
}

export interface PostInput {
  orgId: string;
  entryDate: string; // YYYY-MM-DD — the accounting date, not created_at
  description: string;
  source: string;
  sourceId?: string;
  idempotencyKey: string;
  lines: PostLineInput[];
  createdBy?: string;
}

export interface JournalLine {
  accountCode: string;
  amount: bigint;
  currency: string;
  memo: string | null;
}

export interface JournalEntry {
  id: string;
  orgId: string;
  entryDate: string;
  description: string;
  source: string;
  sourceId: string | null;
  idempotencyKey: string;
  reversesId: string | null;
  lines: JournalLine[];
}

export class UnbalancedEntryError extends Error {
  constructor(sum: bigint) {
    super(`journal entry does not balance: lines sum to ${sum}, expected 0`);
    this.name = "UnbalancedEntryError";
  }
}

export class UnknownAccountError extends Error {
  constructor(code: string) {
    super(`unknown account code: ${code}`);
    this.name = "UnknownAccountError";
  }
}

async function loadEntry(client: PoolClient, orgId: string, entryId: string): Promise<JournalEntry> {
  const entryResult = await client.query<{
    id: string;
    org_id: string;
    entry_date: string;
    description: string;
    source: string;
    source_id: string | null;
    idempotency_key: string;
    reverses_id: string | null;
  }>(
    `select id, org_id, entry_date, description, source, source_id, idempotency_key, reverses_id
     from journal_entries where org_id = $1 and id = $2`,
    [orgId, entryId],
  );
  const entry = entryResult.rows[0];
  if (!entry) throw new Error(`journal entry ${entryId} not found for org ${orgId}`);

  const lineResult = await client.query<{
    amount: string;
    currency: string;
    memo: string | null;
    code: string;
  }>(
    `select jl.amount, jl.currency, jl.memo, a.code
     from journal_lines jl join accounts a on a.id = jl.account_id
     where jl.entry_id = $1
     order by jl.id`,
    [entryId],
  );

  return {
    id: entry.id,
    orgId: entry.org_id,
    entryDate: entry.entry_date,
    description: entry.description,
    source: entry.source,
    sourceId: entry.source_id,
    idempotencyKey: entry.idempotency_key,
    reversesId: entry.reverses_id,
    lines: lineResult.rows.map((row) => ({
      accountCode: row.code,
      amount: toBigInt(row.amount),
      currency: row.currency,
      memo: row.memo,
    })),
  };
}

/**
 * Posts a balanced journal entry. Throws UnbalancedEntryError if the lines
 * don't sum to zero (also enforced by a deferred constraint trigger in
 * Postgres, so no future code path can bypass this). Posting the same
 * idempotencyKey twice is a no-op — the existing entry is returned.
 */
export async function post(client: PoolClient, input: PostInput): Promise<JournalEntry> {
  const existing = await client.query<{ id: string }>(
    "select id from journal_entries where org_id = $1 and idempotency_key = $2",
    [input.orgId, input.idempotencyKey],
  );
  if (existing.rows[0]) {
    return loadEntry(client, input.orgId, existing.rows[0].id);
  }

  const sum = input.lines.reduce((total, line) => total + line.amount, 0n);
  if (sum !== 0n) throw new UnbalancedEntryError(sum);

  const accountRows = await client.query<{ id: string; code: string; currency: string }>(
    "select id, code, currency from accounts where org_id = $1 and code = any($2)",
    [input.orgId, input.lines.map((l) => l.account)],
  );
  const accountsByCode = new Map(accountRows.rows.map((row) => [row.code, row]));
  for (const line of input.lines) {
    if (!accountsByCode.has(line.account)) throw new UnknownAccountError(line.account);
  }

  const entryResult = await client.query<{ id: string }>(
    `insert into journal_entries (org_id, entry_date, description, source, source_id, idempotency_key, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      input.orgId,
      input.entryDate,
      input.description,
      input.source,
      input.sourceId ?? null,
      input.idempotencyKey,
      input.createdBy ?? null,
    ],
  );
  const entryId = entryResult.rows[0]!.id;

  for (const line of input.lines) {
    const account = accountsByCode.get(line.account)!;
    await client.query(
      `insert into journal_lines (entry_id, account_id, amount, currency, memo)
       values ($1, $2, $3, $4, $5)`,
      [entryId, account.id, line.amount, account.currency, line.memo ?? null],
    );
  }

  return loadEntry(client, input.orgId, entryId);
}

export interface BalanceOptions {
  asOf?: string; // YYYY-MM-DD
}

/** The balance of a single account, derived by summing its lines — never cached. */
export async function balance(
  client: PoolClient,
  orgId: string,
  accountCode: string,
  options: BalanceOptions = {},
): Promise<bigint> {
  const params: unknown[] = [orgId, accountCode];
  let dateFilter = "";
  if (options.asOf) {
    dateFilter = "and je.entry_date <= $3";
    params.push(options.asOf);
  }

  const result = await client.query<{ total: string | null }>(
    `select sum(jl.amount) as total
     from journal_lines jl
     join accounts a on a.id = jl.account_id
     join journal_entries je on je.id = jl.entry_id
     where a.org_id = $1 and a.code = $2 ${dateFilter}`,
    params,
  );
  return toBigInt(result.rows[0]?.total ?? "0");
}

/** Sum of all lines per currency. Each currency's sum must be exactly 0n, always. */
export async function trialBalance(
  client: PoolClient,
  orgId: string,
  options: BalanceOptions = {},
): Promise<Record<string, bigint>> {
  const params: unknown[] = [orgId];
  let dateFilter = "";
  if (options.asOf) {
    dateFilter = "and je.entry_date <= $2";
    params.push(options.asOf);
  }

  const result = await client.query<{ currency: string; total: string }>(
    `select jl.currency, sum(jl.amount) as total
     from journal_lines jl
     join accounts a on a.id = jl.account_id
     join journal_entries je on je.id = jl.entry_id
     where a.org_id = $1 ${dateFilter}
     group by jl.currency`,
    params,
  );

  const totals: Record<string, bigint> = {};
  for (const row of result.rows) totals[row.currency] = toBigInt(row.total);
  return totals;
}

export interface ReverseOptions {
  reason: string;
  idempotencyKey?: string;
  entryDate?: string;
}

/** Posts the mirror image of `entryId` (same lines, negated amounts). Both entries stay visible; nothing is edited or deleted. */
export async function reverse(
  client: PoolClient,
  orgId: string,
  entryId: string,
  options: ReverseOptions,
): Promise<JournalEntry> {
  const original = await loadEntry(client, orgId, entryId);
  const idempotencyKey = options.idempotencyKey ?? `reverse:${entryId}`;

  const existing = await client.query<{ id: string }>(
    "select id from journal_entries where org_id = $1 and idempotency_key = $2",
    [orgId, idempotencyKey],
  );
  if (existing.rows[0]) {
    return loadEntry(client, orgId, existing.rows[0].id);
  }

  const entryResult = await client.query<{ id: string }>(
    `insert into journal_entries (org_id, entry_date, description, source, source_id, idempotency_key, reverses_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      orgId,
      options.entryDate ?? original.entryDate,
      `Reversal: ${original.description} (${options.reason})`,
      original.source,
      original.sourceId,
      idempotencyKey,
      entryId,
    ],
  );
  const reversalId = entryResult.rows[0]!.id;

  const accountRows = await client.query<{ id: string; code: string }>(
    "select id, code from accounts where org_id = $1 and code = any($2)",
    [orgId, original.lines.map((l) => l.accountCode)],
  );
  const accountsByCode = new Map(accountRows.rows.map((row) => [row.code, row.id]));

  for (const line of original.lines) {
    await client.query(
      `insert into journal_lines (entry_id, account_id, amount, currency, memo)
       values ($1, $2, $3, $4, $5)`,
      [reversalId, accountsByCode.get(line.accountCode), -line.amount, line.currency, line.memo],
    );
  }

  return loadEntry(client, orgId, reversalId);
}
