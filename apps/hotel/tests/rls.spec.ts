import { closePool, withUserContext } from "@bp/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, createTestOrg, createTestProperty, createTestRoom } from "./helpers.js";

/**
 * Proves tenant isolation for Portier's own tables, the same way
 * apps/coop/tests/rls.spec.ts proves it for members/loans: a member of Org
 * A cannot read or write Org B's properties or rooms — rooms carries no
 * org_id of its own and relies on the join-based policy in
 * migrations/0001_hotel.sql.
 */
describe("cross-tenant row-level security", () => {
  let orgA: string;
  let orgB: string;
  let userA: string;
  let propertyB: string;
  let roomB: string;
  let admin: pg.Client;

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();

    const a = await createTestOrg(admin, "Hotel Org A");
    const b = await createTestOrg(admin, "Hotel Org B");
    orgA = a.orgId;
    userA = a.ownerId;
    orgB = b.orgId;

    propertyB = await createTestProperty(admin, orgB, "Org B Property");
    roomB = await createTestRoom(admin, propertyB, "101");
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("a member of Org A cannot read Org B's properties", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from properties where org_id = $1", [orgB]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it("a member of Org A cannot list any of Org B's properties via an unfiltered scan", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from properties").then((r) => r.rows.map((row) => row.id as string)),
    );
    expect(rows).not.toContain(propertyB);
  });

  it("a member of Org A cannot read Org B's rooms (join-based policy)", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from rooms where id = $1", [roomB]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it("a member of Org A cannot insert a property into Org B", async () => {
    const rows = await withUserContext(userA, (client) =>
      client
        .query("insert into properties (org_id, name, currency) values ($1, 'Forged', 'NGN') returning id", [orgB])
        .then((r) => r.rows)
        .catch(() => []),
    );
    expect(rows).toHaveLength(0);

    const check = await admin.query("select 1 from properties where org_id = $1 and name = 'Forged'", [orgB]);
    expect(check.rows).toHaveLength(0);
  });

  it("a session with no user context reads nothing", async () => {
    const rows = await withUserContext("", (client) =>
      client.query("select id from properties where org_id = $1", [orgA]).then((r) => r.rows).catch(() => []),
    );
    expect(rows).toHaveLength(0);
  });
});
