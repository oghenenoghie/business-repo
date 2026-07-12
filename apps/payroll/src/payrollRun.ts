import { post, toBigInt } from "@bp/ledger";
import { calculatePayslip, NG_2026 } from "@bp/rules";
import type { PoolClient } from "pg";
import { listActiveEmployees } from "./employees.js";
import { periodBounds } from "./period.js";
import { buildSnapshot } from "./snapshot.js";
import type { PayrollRun, PayrollRunStatus } from "./types.js";

const RULE_SETS: Record<string, typeof NG_2026> = { NG: NG_2026 };

class InvalidRunStateError extends Error {
  constructor(runId: string, expected: PayrollRunStatus, actual: PayrollRunStatus) {
    super(`payroll run ${runId} must be "${expected}" to do this, but is "${actual}"`);
    this.name = "InvalidRunStateError";
  }
}

function toRun(row: {
  id: string;
  org_id: string;
  period: string;
  jurisdiction: string;
  rule_set_version: string;
  status: string;
  journal_entry_id: string | null;
}): PayrollRun {
  return {
    id: row.id,
    orgId: row.org_id,
    period: row.period,
    jurisdiction: row.jurisdiction,
    ruleSetVersion: row.rule_set_version,
    status: row.status as PayrollRunStatus,
    journalEntryId: row.journal_entry_id,
  };
}

/** Idempotent: creating a run for a (org, period, jurisdiction) that already exists returns the existing run. */
export async function createPayrollRun(client: PoolClient, orgId: string, period: string, jurisdiction = "NG"): Promise<PayrollRun> {
  const ruleSet = RULE_SETS[jurisdiction];
  if (!ruleSet) throw new Error(`no rule set for jurisdiction ${jurisdiction}`);

  const existing = await client.query<Parameters<typeof toRun>[0]>(
    "select * from payroll_runs where org_id = $1 and period = $2 and jurisdiction = $3",
    [orgId, period, jurisdiction],
  );
  if (existing.rows[0]) return toRun(existing.rows[0]);

  const result = await client.query<Parameters<typeof toRun>[0]>(
    `insert into payroll_runs (org_id, period, jurisdiction, rule_set_version, status)
     values ($1, $2, $3, $4, 'draft')
     returning *`,
    [orgId, period, jurisdiction, ruleSet.version],
  );
  return toRun(result.rows[0]!);
}

async function loadRun(client: PoolClient, orgId: string, runId: string): Promise<PayrollRun> {
  const result = await client.query<Parameters<typeof toRun>[0]>("select * from payroll_runs where org_id = $1 and id = $2", [
    orgId,
    runId,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error(`payroll run ${runId} not found for org ${orgId}`);
  return toRun(row);
}

/**
 * Calculates every active employee's payslip for the run's period and
 * persists them. Only valid from "draft" — once a run has moved past that,
 * this throws, which is what makes an approved run immutable to
 * recalculation.
 */
export async function calculateRun(client: PoolClient, orgId: string, runId: string): Promise<PayrollRun> {
  const run = await loadRun(client, orgId, runId);
  if (run.status !== "draft") throw new InvalidRunStateError(runId, "draft", run.status);

  const ruleSet = RULE_SETS[run.jurisdiction];
  if (!ruleSet) throw new Error(`no rule set for jurisdiction ${run.jurisdiction}`);

  const { start, end } = periodBounds(run.period);
  const employees = await listActiveEmployees(client, orgId, start, end);

  for (const employee of employees) {
    const snapshot = await buildSnapshot(client, employee, start);
    const payslip = calculatePayslip(snapshot, ruleSet, run.period);

    const payslipResult = await client.query<{ id: string }>(
      `insert into payslips (run_id, employee_id, gross, total_deductions, total_employer_liabilities, net, employee_snapshot)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        runId,
        employee.id,
        payslip.gross,
        payslip.totalDeductions,
        payslip.totalEmployerLiabilities,
        payslip.net,
        JSON.stringify(snapshot, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
      ],
    );
    const payslipId = payslipResult.rows[0]!.id;

    for (const line of payslip.lines) {
      await client.query(
        `insert into payslip_lines (payslip_id, code, name, type, amount) values ($1, $2, $3, $4, $5)`,
        [payslipId, line.code, line.name, line.type, line.amount],
      );
    }
  }

  await client.query("update payroll_runs set status = 'calculated' where id = $1", [runId]);
  return { ...run, status: "calculated" };
}

const ACCOUNT_FOR_CODE: Record<string, string> = {
  PAYE: "2100",
  PENSION_EMPLOYEE: "2200",
  PENSION_EMPLOYER: "2200",
  NHF: "2300",
  NSITF: "2500",
  ITF: "2600",
};

/**
 * Posts one balanced journal entry for the whole run (real payroll systems
 * post in aggregate, not per employee) and marks the run posted. Only
 * valid from "calculated" — this is where immutability actually starts:
 * once posted, the run can never be recalculated (calculateRun requires
 * "draft") or posted again (this requires "calculated").
 */
export async function approveAndPostRun(
  client: PoolClient,
  orgId: string,
  runId: string,
  approvedBy: string,
): Promise<PayrollRun> {
  const run = await loadRun(client, orgId, runId);
  if (run.status !== "calculated") throw new InvalidRunStateError(runId, "calculated", run.status);

  const lineRows = await client.query<{ code: string; type: string; amount: string }>(
    `select pl.code, pl.type, pl.amount
     from payslip_lines pl
     join payslips p on p.id = pl.payslip_id
     where p.run_id = $1`,
    [runId],
  );

  const totals: Record<string, bigint> = {};
  let salaryExpense = 0n;
  for (const row of lineRows.rows) {
    const amount = toBigInt(row.amount);
    if (row.type === "earning") {
      salaryExpense += amount;
    } else if (row.type === "employer_liability") {
      salaryExpense += amount;
      const account = ACCOUNT_FOR_CODE[row.code];
      if (account) totals[account] = (totals[account] ?? 0n) + amount;
    } else if (row.type === "deduction") {
      const account = ACCOUNT_FOR_CODE[row.code];
      if (account) totals[account] = (totals[account] ?? 0n) + amount;
    }
  }

  const netResult = await client.query<{ total: string | null }>(
    "select sum(net) as total from payslips where run_id = $1",
    [runId],
  );
  const netTotal = toBigInt(netResult.rows[0]?.total ?? "0");
  totals["2900"] = (totals["2900"] ?? 0n) + netTotal;

  const lines = [
    { account: "6000", amount: salaryExpense },
    ...Object.entries(totals)
      .filter(([, amount]) => amount !== 0n)
      .map(([account, amount]) => ({ account, amount: -amount })),
  ];

  const { end } = periodBounds(run.period);
  const entry = await post(client, {
    orgId,
    entryDate: end,
    description: `Payroll ${run.period}`,
    source: "payroll",
    sourceId: runId,
    idempotencyKey: `payroll:${runId}`,
    lines,
    createdBy: approvedBy,
  });

  await client.query(
    `update payroll_runs
     set status = 'posted', journal_entry_id = $2, approved_by = $3, approved_at = now()
     where id = $1`,
    [runId, entry.id, approvedBy],
  );

  return { ...run, status: "posted", journalEntryId: entry.id };
}
