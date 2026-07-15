import { closePool, withUserContext } from "@bp/core";
import { balance, trialBalance } from "@bp/ledger";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember } from "../src/members.js";
import { ContributionAlreadyPostedError, postContribution } from "../src/contributions.js";
import { getMemberStatement } from "../src/statement.js";
import { adminClient, createTestOrg, seedCoopChart } from "./helpers.js";

describe("contributions post to the ledger and the statement derives from it", () => {
  let admin: pg.Client;
  let orgId: string;
  let ownerId: string;
  let memberId: string;

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();

    const org = await createTestOrg(admin, "Statement Test Coop");
    orgId = org.orgId;
    ownerId = org.ownerId;

    await withUserContext(ownerId, (client) => seedCoopChart(client, orgId, "NGN"));

    const member = await withUserContext(ownerId, (client) =>
      createMember(client, { orgId, membershipNumber: "M-001", fullName: "Test Member", joinDate: "2025-01-01" }),
    );
    memberId = member.id;
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("posts two months of contributions and the statement matches, running balance included", async () => {
    await withUserContext(ownerId, (client) =>
      postContribution(client, { orgId, memberId, periodYear: 2026, periodMonth: 1, amount: 500_00n }),
    );
    await withUserContext(ownerId, (client) =>
      postContribution(client, { orgId, memberId, periodYear: 2026, periodMonth: 2, amount: 750_00n }),
    );

    const statement = await withUserContext(ownerId, (client) => getMemberStatement(client, orgId, memberId));

    expect(statement).not.toBeNull();
    expect(statement!.lines).toHaveLength(2);
    expect(statement!.lines[0]!.amount).toBe(500_00n);
    expect(statement!.lines[0]!.runningBalance).toBe(500_00n);
    expect(statement!.lines[1]!.amount).toBe(750_00n);
    expect(statement!.lines[1]!.runningBalance).toBe(1250_00n);
    expect(statement!.savingsBalance).toBe(1250_00n);
  });

  it("the statement's balance matches the ledger's own account balance for 2100 Member Savings", async () => {
    const ledgerBalance = await withUserContext(ownerId, (client) => balance(client, orgId, "2100"));
    // Credits are negative in this ledger's convention; the member's savings
    // balance is the positive mirror of that.
    expect(-ledgerBalance).toBe(1250_00n);
  });

  it("the org's trial balance still sums to exactly zero after both postings", async () => {
    const totals = await withUserContext(ownerId, (client) => trialBalance(client, orgId));
    expect(totals["NGN"]).toBe(0n);
  });

  it("posting the same member and period twice is rejected, not double-posted", async () => {
    await expect(
      withUserContext(ownerId, (client) =>
        postContribution(client, { orgId, memberId, periodYear: 2026, periodMonth: 1, amount: 500_00n }),
      ),
    ).rejects.toThrow(ContributionAlreadyPostedError);

    const statement = await withUserContext(ownerId, (client) => getMemberStatement(client, orgId, memberId));
    expect(statement!.lines).toHaveLength(2);
    expect(statement!.savingsBalance).toBe(1250_00n);
  });
});
