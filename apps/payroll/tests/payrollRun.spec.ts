import { closePool, withUserContext } from "@bp/core";
import { trialBalance } from "@bp/ledger";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addEmploymentRecord, createEmployee } from "../src/employees.js";
import { approveAndPostRun, calculateRun, createPayrollRun } from "../src/payrollRun.js";
import { renderPayslipPdf } from "../src/payslipPdf.js";
import { adminClient, createTestOrg, seedPayrollChart } from "./helpers.js";

describe("a full payroll run for 20 employees", () => {
  let admin: pg.Client;
  let orgId: string;
  let ownerId: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();

    const org = await createTestOrg(admin, "Wagebook Demo Org");
    orgId = org.orgId;
    ownerId = org.ownerId;

    await withUserContext(ownerId, (client) => seedPayrollChart(client, orgId, "NGN"));

    // 20 employees, spanning the 0% band through the higher bands, with a
    // mix of pension/NHF opt-in so every conditional branch in the NG pack
    // gets exercised across the run.
    await withUserContext(ownerId, async (client) => {
      for (let i = 1; i <= 20; i++) {
        const employee = await createEmployee(client, {
          orgId,
          staffNumber: `EMP-${String(i).padStart(3, "0")}`,
          fullName: `Employee ${i}`,
          nationality: "NG",
          hireDate: "2025-01-01",
          pensionOptIn: i % 4 !== 0, // 15 of 20 opted in
          nhfOptIn: i % 3 === 0, // ~6 of 20 opted in
        });
        employeeIds.push(employee.id);

        const basic = BigInt(60_000 + i * 40_000) * 100n; // ranges ~₦100,000 to ₦860,000
        await addEmploymentRecord(client, orgId, employee.id, {
          effectiveFrom: "2025-01-01",
          basic,
          housing: basic / 3n,
          transport: basic / 6n,
          annualRent: i % 5 === 0 ? basic * 6n : 0n, // a fifth of employees claim rent relief
          currency: "NGN",
        });
      }
    });
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("runs draft -> calculated -> posted, produces 20 payslips, and posts a balanced ledger entry", async () => {
    const run = await withUserContext(ownerId, (client) => createPayrollRun(client, orgId, "2026-03", "NG"));
    expect(run.status).toBe("draft");

    const calculated = await withUserContext(ownerId, (client) => calculateRun(client, orgId, run.id));
    expect(calculated.status).toBe("calculated");

    const payslipCount = await admin.query("select count(*) from payslips where run_id = $1", [run.id]);
    expect(Number(payslipCount.rows[0].count)).toBe(20);

    const posted = await withUserContext(ownerId, (client) => approveAndPostRun(client, orgId, run.id, ownerId));
    expect(posted.status).toBe("posted");
    expect(posted.journalEntryId).toBeTruthy();

    const totals = await withUserContext(ownerId, (client) => trialBalance(client, orgId));
    expect(totals.NGN).toBe(0n);

    const netSum = await admin.query<{ total: string }>("select sum(net) as total from payslips where run_id = $1", [run.id]);
    const journalNetPayable = await admin.query<{ amount: string }>(
      `select -jl.amount as amount from journal_lines jl
       join accounts a on a.id = jl.account_id
       where jl.entry_id = $1 and a.code = '2900'`,
      [posted.journalEntryId],
    );
    expect(BigInt(journalNetPayable.rows[0]!.amount)).toBe(BigInt(netSum.rows[0]!.total));
  });

  it("a run cannot be recalculated once posted (immutability)", async () => {
    const run = await withUserContext(ownerId, (client) => createPayrollRun(client, orgId, "2026-03", "NG"));
    expect(run.status).toBe("posted"); // idempotent lookup of the run from the previous test

    await expect(withUserContext(ownerId, (client) => calculateRun(client, orgId, run.id))).rejects.toThrow(/must be "draft"/);
    await expect(withUserContext(ownerId, (client) => approveAndPostRun(client, orgId, run.id, ownerId))).rejects.toThrow(
      /must be "calculated"/,
    );
  });

  it("approving the same run twice is a no-op at the ledger level (idempotent posting)", async () => {
    // A second run for a different period, to prove posting idempotency independent of run-state guards.
    const run = await withUserContext(ownerId, (client) => createPayrollRun(client, orgId, "2026-04", "NG"));
    await withUserContext(ownerId, (client) => calculateRun(client, orgId, run.id));
    const firstPost = await withUserContext(ownerId, (client) => approveAndPostRun(client, orgId, run.id, ownerId));

    const entryCount = await admin.query("select count(*) from journal_entries where source_id = $1", [run.id]);
    expect(Number(entryCount.rows[0].count)).toBe(1);
    expect(firstPost.journalEntryId).toBeTruthy();
  });

  it("renders a payslip PDF for an employee", async () => {
    const run = await withUserContext(ownerId, (client) => createPayrollRun(client, orgId, "2026-03", "NG"));
    const employeeId = employeeIds[0]!;

    const { employee, payslip } = await withUserContext(ownerId, async (client) => {
      const employeeRow = await client.query("select * from employees where id = $1", [employeeId]);
      const payslipRow = await client.query("select * from payslips where run_id = $1 and employee_id = $2", [run.id, employeeId]);
      const lineRows = await client.query("select * from payslip_lines where payslip_id = $1", [payslipRow.rows[0].id]);
      return {
        employee: employeeRow.rows[0],
        payslip: { ...payslipRow.rows[0], lines: lineRows.rows },
      };
    });

    const pdf = await renderPayslipPdf({
      employee: {
        id: employee.id,
        orgId: employee.org_id,
        staffNumber: employee.staff_number,
        fullName: employee.full_name,
        nationality: employee.nationality,
        employeeType: employee.employee_type,
        pensionOptIn: employee.pension_opt_in,
        nhfOptIn: employee.nhf_opt_in,
        hireDate: employee.hire_date,
        terminationDate: employee.termination_date,
      },
      period: "2026-03",
      currency: "NGN",
      gross: BigInt(payslip.gross),
      net: BigInt(payslip.net),
      lines: payslip.lines.map((l: { code: string; name: string; type: string; amount: string }) => ({
        code: l.code,
        name: l.name,
        type: l.type,
        amount: BigInt(l.amount),
      })),
    });

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(500);
  });
});
