import { closePool, withUserContext } from "@bp/core";
import { trialBalance } from "@bp/ledger";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember } from "../src/members.js";
import { postContribution } from "../src/contributions.js";
import {
  InvalidDividendRunStateError,
  allocateDividends,
  approveDividendRun,
  createDividendRun,
  getDividendAllocations,
  getDividendRun,
  postDividendRun,
} from "../src/dividends.js";
import { adminClient, createTestOrg, seedCoopChart } from "./helpers.js";

describe("dividend allocation, largest-remainder method", () => {
  let admin: pg.Client;
  let orgId: string;
  let ownerId: string;
  // Deliberately doesn't divide evenly against any surplus below, to prove
  // the largest-remainder correction — not just the floor division — is
  // what makes sum(allocated) === surplus exactly.
  const savings = [100n, 250n, 375n];

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();
    const org = await createTestOrg(admin, "Dividend Test Coop");
    orgId = org.orgId;
    ownerId = org.ownerId;
    await withUserContext(ownerId, (client) => seedCoopChart(client, orgId, "NGN"));

    for (let i = 0; i < savings.length; i++) {
      const member = await withUserContext(ownerId, (client) =>
        createMember(client, {
          orgId,
          membershipNumber: `M-00${i + 1}`,
          fullName: `Member ${i + 1}`,
          joinDate: "2025-01-01",
        }),
      );
      await withUserContext(ownerId, (client) =>
        postContribution(client, { orgId, memberId: member.id, periodYear: 2026, periodMonth: 1, amount: savings[i]! }),
      );
    }
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("allocates pro-rata on savings and reconciles exactly to the surplus", async () => {
    const surplus = 1000n;
    const run = await withUserContext(ownerId, (client) =>
      createDividendRun(client, { orgId, financialYear: 2026, distributableSurplus: surplus, basis: "savings" }),
    );
    expect(run.status).toBe("draft");

    const allocations = await withUserContext(ownerId, (client) => allocateDividends(client, run.id));
    expect(allocations).toHaveLength(3);

    const totalBasis = savings.reduce((sum, s) => sum + s, 0n);
    let sumAllocated = 0n;
    for (const allocation of allocations) {
      // Every allocation is either the plain floor share, or exactly one
      // minor unit more (the largest-remainder top-up) — never further off.
      const floorShare = (surplus * allocation.basisAmount) / totalBasis;
      expect([floorShare, floorShare + 1n]).toContain(allocation.allocated);
      sumAllocated += allocation.allocated;
    }
    expect(sumAllocated).toBe(surplus);

    const stored = await withUserContext(ownerId, (client) => getDividendAllocations(client, run.id));
    expect(stored).toHaveLength(3);

    const reloaded = await withUserContext(ownerId, (client) => getDividendRun(client, run.id));
    expect(reloaded!.status).toBe("allocated");
  });

  it("cannot allocate a run twice", async () => {
    const run = await withUserContext(ownerId, (client) =>
      createDividendRun(client, { orgId, financialYear: 2027, distributableSurplus: 500n, basis: "savings" }),
    );
    await withUserContext(ownerId, (client) => allocateDividends(client, run.id));
    await expect(withUserContext(ownerId, (client) => allocateDividends(client, run.id))).rejects.toThrow(
      InvalidDividendRunStateError,
    );
  });

  it("approves and posts a dividend run to the ledger, keeping the trial balance at zero", async () => {
    const surplus = 900n;
    const run = await withUserContext(ownerId, (client) =>
      createDividendRun(client, { orgId, financialYear: 2028, distributableSurplus: surplus, basis: "savings" }),
    );
    await withUserContext(ownerId, (client) => allocateDividends(client, run.id));

    const approved = await withUserContext(ownerId, (client) => approveDividendRun(client, run.id, ownerId));
    expect(approved.status).toBe("approved");

    const posted = await withUserContext(ownerId, (client) => postDividendRun(client, run.id));
    expect(posted.status).toBe("posted");
    expect(posted.journalEntryId).not.toBeNull();

    const totals = await withUserContext(ownerId, (client) => trialBalance(client, orgId));
    expect(totals["NGN"]).toBe(0n);
  });

  it("cannot post a run that hasn't been approved yet", async () => {
    const run = await withUserContext(ownerId, (client) =>
      createDividendRun(client, { orgId, financialYear: 2029, distributableSurplus: 100n, basis: "savings" }),
    );
    await expect(withUserContext(ownerId, (client) => postDividendRun(client, run.id))).rejects.toThrow(
      InvalidDividendRunStateError,
    );
  });
});
