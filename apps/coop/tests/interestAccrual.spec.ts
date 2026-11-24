import { closePool, withUserContext } from "@bp/core";
import { balance, trialBalance } from "@bp/ledger";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember } from "../src/members.js";
import { postContribution } from "../src/contributions.js";
import { applyForLoan, approveLoan, disburseLoan, getRepaymentSchedule, postRepayment } from "../src/loans.js";
import { listInterestAccrualRuns, runInterestAccrual } from "../src/interestAccrual.js";
import { adminClient, createTestOrg, seedCoopChart } from "./helpers.js";

describe("interest accrual", () => {
  let admin: pg.Client;
  let orgId: string;
  let ownerId: string;
  let loanId: string;

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();
    const org = await createTestOrg(admin, "Accrual Test Coop");
    orgId = org.orgId;
    ownerId = org.ownerId;
    await withUserContext(ownerId, (client) => seedCoopChart(client, orgId, "NGN"));

    const memberId = (
      await withUserContext(ownerId, (client) =>
        createMember(client, { orgId, membershipNumber: "M-001", fullName: "Borrower", joinDate: "2025-01-01" }),
      )
    ).id;
    await withUserContext(ownerId, (client) =>
      postContribution(client, { orgId, memberId, periodYear: 2026, periodMonth: 1, amount: 1_000_000n }),
    );

    // 90,000 at 12%/yr flat over 3 months: totalInterest = 90000*0.12*3/12 =
    // 2700, split evenly to 900 per installment — deliberately round numbers
    // so the accrual math below is easy to check by hand.
    const loan = await withUserContext(ownerId, (client) =>
      applyForLoan(client, { orgId, memberId, principal: 90_000n, interestRate: 0.12, tenorMonths: 3, method: "flat" }),
    );
    loanId = loan.id;
    await withUserContext(ownerId, (client) => approveLoan(client, loanId, ownerId));
    await withUserContext(ownerId, (client) => disburseLoan(client, loanId));

    // Push the first two installments into the past so an accrual run as of
    // today finds them due-but-unpaid; leave the third due in the future.
    await admin.query(
      `update repayment_schedules set due_date = current_date - interval '10 days'
       where loan_id = $1 and installment_no in (1, 2)`,
      [loanId],
    );
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("accrues interest only for due-but-unpaid installments, Dr Interest Receivable / Cr Interest Income", async () => {
    const asOfDate = new Date().toISOString().slice(0, 10);
    const run = await withUserContext(ownerId, (client) => runInterestAccrual(client, orgId, asOfDate));

    expect(run).not.toBeNull();
    expect(run!.amount).toBe(1_800n); // two installments x 900 interest each

    const receivable = await withUserContext(ownerId, (client) => balance(client, orgId, "1150"));
    expect(receivable).toBe(1_800n);

    const schedule = await withUserContext(ownerId, (client) => getRepaymentSchedule(client, loanId));
    expect(schedule[0]!.accruedAt).not.toBeNull();
    expect(schedule[1]!.accruedAt).not.toBeNull();
    expect(schedule[2]!.accruedAt).toBeNull(); // not yet due, untouched

    const totals = await withUserContext(ownerId, (client) => trialBalance(client, orgId));
    expect(totals["NGN"]).toBe(0n);
  });

  it("a second accrual run the same day finds nothing left to accrue", async () => {
    const asOfDate = new Date().toISOString().slice(0, 10);
    const run = await withUserContext(ownerId, (client) => runInterestAccrual(client, orgId, asOfDate));
    expect(run).toBeNull();

    const runs = await withUserContext(ownerId, (client) => listInterestAccrualRuns(client, orgId));
    expect(runs).toHaveLength(1);
  });

  it("repaying an already-accrued installment credits the receivable, not income again", async () => {
    // Installment 1 was accrued above; repaying it should draw down 1150
    // rather than booking its interest to 4100 a second time.
    await withUserContext(ownerId, (client) => postRepayment(client, { loanId }));

    const receivable = await withUserContext(ownerId, (client) => balance(client, orgId, "1150"));
    expect(receivable).toBe(900n); // 1,800 accrued - 900 cleared by this repayment

    const income = await withUserContext(ownerId, (client) => balance(client, orgId, "4100"));
    // Both accrued installments' interest was already recognized as income
    // at the accrual step (-1,800 total); this repayment draws down the
    // receivable instead of crediting 4100 again, so income is unchanged.
    expect(income).toBe(-1_800n);

    const totals = await withUserContext(ownerId, (client) => trialBalance(client, orgId));
    expect(totals["NGN"]).toBe(0n);
  });

  it("repaying a never-accrued installment books straight to income, cash-basis", async () => {
    await withUserContext(ownerId, (client) => postRepayment(client, { loanId })); // installment 2, accrued
    await withUserContext(ownerId, (client) => postRepayment(client, { loanId })); // installment 3, never accrued

    const receivable = await withUserContext(ownerId, (client) => balance(client, orgId, "1150"));
    expect(receivable).toBe(0n); // fully cleared once every accrued installment is repaid

    const income = await withUserContext(ownerId, (client) => balance(client, orgId, "4100"));
    expect(income).toBe(-2_700n); // total interest over the loan's life, recognized exactly once

    const totals = await withUserContext(ownerId, (client) => trialBalance(client, orgId));
    expect(totals["NGN"]).toBe(0n);
  });
});
