import { closePool, withUserContext } from "@bp/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, createTestOrg, createTestTeacher } from "./helpers.js";

/**
 * Proves tenant isolation for Termly's own tables, the same way
 * apps/coop and apps/hotel's rls.spec.ts prove it for their tables: a
 * member of Org A cannot read or write Org B's teachers or the
 * join-based `teacher_availability` rows that hang off them.
 */
describe("cross-tenant row-level security", () => {
  let orgA: string;
  let orgB: string;
  let userA: string;
  let teacherB: string;
  let admin: pg.Client;

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();

    const a = await createTestOrg(admin, "School Org A");
    const b = await createTestOrg(admin, "School Org B");
    orgA = a.orgId;
    userA = a.ownerId;
    orgB = b.orgId;

    teacherB = await createTestTeacher(admin, orgB, "Mr. Okoro");
    await admin.query(
      "insert into teacher_availability (teacher_id, day_of_week, period_index) values ($1, 1, 3)",
      [teacherB],
    );
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("a member of Org A cannot read Org B's teachers", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from teachers where org_id = $1", [orgB]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it("a member of Org A cannot list any of Org B's teachers via an unfiltered scan", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from teachers").then((r) => r.rows.map((row) => row.id as string)),
    );
    expect(rows).not.toContain(teacherB);
  });

  it("a member of Org A cannot read Org B's teacher availability (join-based policy)", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from teacher_availability where teacher_id = $1", [teacherB]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it("a member of Org A cannot insert a teacher into Org B", async () => {
    const rows = await withUserContext(userA, (client) =>
      client
        .query("insert into teachers (org_id, full_name) values ($1, 'Forged') returning id", [orgB])
        .then((r) => r.rows)
        .catch(() => []),
    );
    expect(rows).toHaveLength(0);

    const check = await admin.query("select 1 from teachers where org_id = $1 and full_name = 'Forged'", [orgB]);
    expect(check.rows).toHaveLength(0);
  });

  it("a session with no user context reads nothing", async () => {
    const rows = await withUserContext("", (client) =>
      client.query("select id from teachers where org_id = $1", [orgA]).then((r) => r.rows).catch(() => []),
    );
    expect(rows).toHaveLength(0);
  });
});
