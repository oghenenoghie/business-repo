import { closePool, withUserContext } from "@bp/core";
import { trialBalance } from "@bp/ledger";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember } from "../src/members.js";
import { postContribution } from "../src/contributions.js";
import {
  InvalidLoanStateError,
  LoanEligibilityError,
  addGuarantor,
  applyForLoan,
  approveLoan,
  checkEligibility,
  disburseLoan,
  generateFlatSchedule,
  getArrearsReport,
  getLoan,
  getRepaymentSchedule,
  postRepayment,
  setSavingsMultiplier,
} from "../src/loans.js";
import { adminClient, createTestOrg, seedCoopChart } from "./helpers.js";

describe("flat-rate amortization schedule", () => {
  it("sums exactly to principal and total interest, no rounding drift", () => {
    // 100,000 minor units at 15% annual over 7 months — deliberately doesn't
    // divide evenly, to prove the final installment absorbs the residual.
    const schedule = generateFlatSchedule(100_000n, 0.15, 7, "2026-01-15");

    expect(schedule).toHaveLength(7);
    const principalSum = schedule.reduce((sum, i) => sum + i.principalDue, 0n);
    const interestSum = schedule.reduce((sum, i) => sum + i.interestDue, 0n);
    expect(principalSum).toBe(100_000n);
    // totalInterest = round(100000 * 0.15 * 7/12) = round(8750) = 8750
    expect(interestSum).toBe(8_750n);

    expect(schedule[0]!.dueDate).toBe("2026-02-15");
    expect(schedule[6]!.dueDate).toBe("2026-08-15");
  });

  it("a single-installment loan puts the whole principal and interest in that one installment", () => {
    const schedule = generateFlatSchedule(50_000n, 0.1, 1, "2026-01-01");
    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.principalDue).toBe(50_000n);
  });
});

describe("loan eligibility, guarantor encumbrance, and the full disbursement/repayment lifecycle", () => {
  let admin: pg.Client;
  let orgId: string;
  let ownerId: string;
  let borrowerId: string;
  let guarantorId: string;

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();

    const org = await createTestOrg(admin, "Loans Test Coop");
    orgId = org.orgId;
    ownerId = org.ownerId;

    await withUserContext(ownerId, (client) => seedCoopChart(client, orgId, "NGN"));

    borrowerId = (
      await withUserContext(ownerId, (client) =>
        createMember(client, { orgId, membershipNumber: "M-001", fullName: "Borrower", joinDate: "2025-01-01" }),
      )
    ).id;
    guarantorId = (
      await withUserContext(ownerId, (client) =>
        createMember(client, { orgId, membershipNumber: "M-002", fullName: "Guarantor", joinDate: "2025-01-01" }),
      )
    ).id;

    // Borrower has 50,000 in savings; guarantor has 200,000.
    await withUserContext(ownerId, (client) =>
      postContribution(client, { orgId, memberId: borrowerId, periodYear: 2026, periodMonth: 1, amount: 50_000n }),
    );
    await withUserContext(ownerId, (client) =>
      postContribution(client, { orgId, memberId: guarantorId, periodYear: 2026, periodMonth: 1, amount: 200_000n }),
    );
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("defaults to a 2x multiplier when no society setting exists", async () => {
    const eligibility = await withUserContext(ownerId, (client) => checkEligibility(client, orgId, borrowerId, 1n));
    expect(eligibility.multiplier).toBe(2);
    expect(eligibility.availableToBorrow).toBe(100_000n); // 50,000 x 2
  });

  it("rejects a loan application beyond available capacity", async () => {
    await expect(
      withUserContext(ownerId, (client) =>
        applyForLoan(client, {
          orgId,
          memberId: borrowerId,
          principal: 150_000n,
          interestRate: 0.15,
          tenorMonths: 6,
          method: "flat",
        }),
      ),
    ).rejects.toThrow(LoanEligibilityError);
  });

  it("society multiplier is configurable and changes eligibility", async () => {
    await withUserContext(ownerId, (client) => setSavingsMultiplier(client, orgId, 3));
    const eligibility = await withUserContext(ownerId, (client) => checkEligibility(client, orgId, borrowerId, 1n));
    expect(eligibility.multiplier).toBe(3);
    expect(eligibility.availableToBorrow).toBe(150_000n); // 50,000 x 3
  });

  let loanId: string;

  it("applies for, guarantees, approves, and disburses a loan within capacity", async () => {
    const loan = await withUserContext(ownerId, (client) =>
      applyForLoan(client, {
        orgId,
        memberId: borrowerId,
        principal: 120_000n,
        interestRate: 0.15,
        tenorMonths: 6,
        method: "flat",
      }),
    );
    loanId = loan.id;
    expect(loan.status).toBe("pending");

    // Borrower's own capacity (150,000) covers 120,000 alone, but prove the
    // guarantor flow works and correctly encumbers the guarantor's capacity.
    await withUserContext(ownerId, (client) =>
      addGuarantor(client, { loanId, memberId: guarantorId, amountGuaranteed: 60_000n }),
    );
    const guarantorEligibility = await withUserContext(ownerId, (client) =>
      checkEligibility(client, orgId, guarantorId, 1n),
    );
    // Guarantor is in the same org, so the multiplier set to 3 above
    // applies to them too: 200,000 savings x 3 - 60,000 guaranteed = 540,000.
    expect(guarantorEligibility.guaranteedExposure).toBe(60_000n);
    expect(guarantorEligibility.availableToBorrow).toBe(540_000n);

    const approved = await withUserContext(ownerId, (client) => approveLoan(client, loanId, ownerId));
    expect(approved.status).toBe("approved");

    const disbursed = await withUserContext(ownerId, (client) => disburseLoan(client, loanId));
    expect(disbursed.status).toBe("active");
    expect(disbursed.journalEntryId).not.toBeNull();

    const schedule = await withUserContext(ownerId, (client) => getRepaymentSchedule(client, loanId));
    expect(schedule).toHaveLength(6);
    const principalSum = schedule.reduce((sum, i) => sum + i.principalDue, 0n);
    expect(principalSum).toBe(120_000n);
  });

  it("cannot disburse a loan that isn't approved", async () => {
    const pendingLoan = await withUserContext(ownerId, (client) =>
      applyForLoan(client, {
        orgId,
        memberId: borrowerId,
        principal: 1_000n,
        interestRate: 0.1,
        tenorMonths: 3,
        method: "flat",
      }),
    );
    await expect(withUserContext(ownerId, (client) => disburseLoan(client, pendingLoan.id))).rejects.toThrow(
      InvalidLoanStateError,
    );
  });

  it("posting every installment repays the loan and the ledger balances throughout", async () => {
    for (let i = 0; i < 6; i++) {
      const repayment = await withUserContext(ownerId, (client) => postRepayment(client, { loanId }));
      expect(repayment.amount).toBe(repayment.principalPortion + repayment.interestPortion);

      const totals = await withUserContext(ownerId, (client) => trialBalance(client, orgId));
      expect(totals["NGN"]).toBe(0n);
    }

    const loan = await withUserContext(ownerId, (client) => getLoan(client, loanId));
    expect(loan!.status).toBe("repaid");
  });

  it("no more installments can be repaid once the loan is fully repaid", async () => {
    await expect(withUserContext(ownerId, (client) => postRepayment(client, { loanId }))).rejects.toThrow(
      InvalidLoanStateError,
    );
  });
});

describe("arrears ageing", () => {
  let admin: pg.Client;
  let orgId: string;
  let ownerId: string;
  let memberId: string;
  let loanId: string;

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();

    const org = await createTestOrg(admin, "Arrears Test Coop");
    orgId = org.orgId;
    ownerId = org.ownerId;
    await withUserContext(ownerId, (client) => seedCoopChart(client, orgId, "NGN"));

    memberId = (
      await withUserContext(ownerId, (client) =>
        createMember(client, { orgId, membershipNumber: "M-001", fullName: "Arrears Member", joinDate: "2025-01-01" }),
      )
    ).id;
    await withUserContext(ownerId, (client) =>
      postContribution(client, { orgId, memberId, periodYear: 2026, periodMonth: 1, amount: 1_000_000n }),
    );

    const loan = await withUserContext(ownerId, (client) =>
      applyForLoan(client, { orgId, memberId, principal: 100_000n, interestRate: 0.12, tenorMonths: 3, method: "flat" }),
    );
    loanId = loan.id;
    await withUserContext(ownerId, (client) => approveLoan(client, loanId, ownerId));
    await withUserContext(ownerId, (client) => disburseLoan(client, loanId));

    // Force the first installment 45 days overdue, to land in the 30 bucket.
    await admin.query(
      `update repayment_schedules set due_date = current_date - interval '45 days'
       where loan_id = $1 and installment_no = 1`,
      [loanId],
    );
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("lists the overdue installment in the 30-day bucket", async () => {
    const arrears = await withUserContext(ownerId, (client) => getArrearsReport(client, orgId));
    const row = arrears.find((r) => r.loanId === loanId);
    expect(row).toBeDefined();
    expect(row!.bucket).toBe("30");
    expect(row!.daysOverdue).toBeGreaterThanOrEqual(45);
  });
});
