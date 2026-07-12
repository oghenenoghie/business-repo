import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, withUserContext } from "../src/db.js";

const { Client } = pg;

/**
 * Proves tenant isolation at the database layer: a member of Org A cannot
 * read or write Org B's rows in any tenant table, no matter what the
 * application code above it does or forgets to do. This is the artifact —
 * see README.md.
 */
describe("cross-tenant row-level security", () => {
  let orgA: string;
  let orgB: string;
  let userA: string;
  let userB: string;
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new Client({
      connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_core_test",
    });
    await admin.connect();

    userA = randomUUID();
    userB = randomUUID();

    const orgAResult = await admin.query<{ id: string }>(
      "insert into organizations (name, slug) values ('Org A', $1) returning id",
      [`org-a-${randomUUID()}`],
    );
    orgA = orgAResult.rows[0]!.id;

    const orgBResult = await admin.query<{ id: string }>(
      "insert into organizations (name, slug) values ('Org B', $1) returning id",
      [`org-b-${randomUUID()}`],
    );
    orgB = orgBResult.rows[0]!.id;

    await admin.query(
      `insert into memberships (org_id, user_id, role)
       values ($1, $2, 'owner'), ($3, $4, 'owner')`,
      [orgA, userA, orgB, userB],
    );
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("a member of Org A can read Org A's row", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from organizations where id = $1", [orgA]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(1);
  });

  it("a member of Org A cannot read Org B's organization row", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from organizations where id = $1", [orgB]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it("a member of Org A cannot list any of Org B's rows via an unfiltered scan", async () => {
    // Simulates the "forgot the where clause" bug: no org_id filter at all.
    const rows = await withUserContext(userA, (client) =>
      client.query("select id from organizations").then((r) => r.rows.map((row) => row.id as string)),
    );
    expect(rows).toContain(orgA);
    expect(rows).not.toContain(orgB);
  });

  it("a member of Org A cannot read Org B's memberships", async () => {
    const rows = await withUserContext(userA, (client) =>
      client.query("select user_id from memberships where org_id = $1", [orgB]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it("a member of Org A cannot insert a membership into Org B", async () => {
    const outsiderId = randomUUID();
    const rows = await withUserContext(userA, (client) =>
      client
        .query("insert into memberships (org_id, user_id, role) values ($1, $2, 'member') returning org_id", [
          orgB,
          outsiderId,
        ])
        .then((r) => r.rows)
        .catch(() => []),
    );
    expect(rows).toHaveLength(0);

    const check = await admin.query("select 1 from memberships where org_id = $1 and user_id = $2", [
      orgB,
      outsiderId,
    ]);
    expect(check.rows).toHaveLength(0);
  });

  it("a member of Org A cannot read Org B's audit events", async () => {
    await admin.query("insert into audit_events (org_id, actor_id, action) values ($1, $2, 'test.event')", [
      orgB,
      userB,
    ]);

    const rows = await withUserContext(userA, (client) =>
      client.query("select id from audit_events where org_id = $1", [orgB]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(0);
  });

  it("a member of Org A cannot write an audit event into Org B", async () => {
    const rows = await withUserContext(userA, (client) =>
      client
        .query("insert into audit_events (org_id, actor_id, action) values ($1, $2, 'test.forged') returning id", [
          orgB,
          userA,
        ])
        .then((r) => r.rows)
        .catch(() => []),
    );
    expect(rows).toHaveLength(0);
  });

  it("a session with no user context reads nothing", async () => {
    const rows = await withUserContext("", (client) =>
      client.query("select id from organizations where id = $1", [orgA]).then((r) => r.rows).catch(() => []),
    );
    expect(rows).toHaveLength(0);
  });
});
