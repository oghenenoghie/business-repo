import { randomUUID } from "node:crypto";
import { closePool, withUserContext } from "@bp/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, createTestMember, createTestOrg } from "./helpers.js";

/**
 * Proves tenant isolation for Ajo's own tables, the same way
 * packages/core/tests/rls.spec.ts proves it for organizations/memberships:
 * a member of Org A cannot read or write Org B's members, loans, or
 * loan-child rows (which carry no org_id of their own and rely on the
 * join-based policies in migrations/0001_coop.sql).
 */
describe("cross-tenant row-level security", () => {
  let orgA: string;
  let orgB: string;
  let userA: string;
  let memberB: string;
  let loanB: string;
  let admin: pg.Client;

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();

    const a = await createTestOrg(admin, "Org A");
    const b = await createTestOrg(admin, "Org B");
    orgA = a.orgId;
    userA = a.ownerId;
    orgB = b.orgId;

    memberB = await createTestMember(admin, orgB, "B-001");

    const loanResult = await admin.query<{ id: string }>(
      `insert into loans (org_id, member_id, principal, interest_rate, tenor_months, method)
       values ($1, $2, 100000, 0.15, 12, 'reducing_balance')
       returning id`,
      [orgB, memberB],
    );
    loanB = loanResult.rows[0]!.id;

    await admin.query(
      `insert into repayment_schedules (loan_id, installment_no, due_date, principal_due, interest_due)
       values ($1, 1, current_date, 8000, 1250)`,
      [loanB],
    );
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("a member of Org A cannot read Org B's members", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from members where org_id = $1", [orgB]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it("a member of Org A cannot list any of Org B's members via an unfiltered scan", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from members").then((r) => r.rows.map((row) => row.id as string)),
    );
    expect(rows).not.toContain(memberB);
  });

  it("a member of Org A cannot read Org B's loans", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from loans where org_id = $1", [orgB]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it("a member of Org A cannot read Org B's repayment schedules (join-based policy)", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from repayment_schedules where loan_id = $1", [loanB]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it("a member of Org A cannot insert a member into Org B", async () => {
    const rows = await withUserContext(userA, (client) =>
      client
        .query(
          `insert into members (org_id, membership_number, full_name, join_date)
           values ($1, 'B-999', 'Forged', current_date) returning id`,
          [orgB],
        )
        .then((r) => r.rows)
        .catch(() => []),
    );
    expect(rows).toHaveLength(0);

    const check = await admin.query("select 1 from members where org_id = $1 and membership_number = 'B-999'", [
      orgB,
    ]);
    expect(check.rows).toHaveLength(0);
  });

  it("a session with no user context reads nothing", async () => {
    const rows = await withUserContext("", (client) =>
      client.query("select id from members where org_id = $1", [orgA]).then((r) => r.rows).catch(() => []),
    );
    expect(rows).toHaveLength(0);
  });
});
