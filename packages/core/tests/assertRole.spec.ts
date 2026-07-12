import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRole, ForbiddenError } from "../src/assertRole.js";
import { closePool, withUserContext } from "../src/db.js";

const { Client } = pg;

describe("assertRole", () => {
  let org: string;
  let owner: string;
  let viewer: string;
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new Client({
      connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_core_test",
    });
    await admin.connect();

    owner = randomUUID();
    viewer = randomUUID();

    const result = await admin.query<{ id: string }>(
      "insert into organizations (name, slug) values ('Assert Role Org', $1) returning id",
      [`assert-role-${randomUUID()}`],
    );
    org = result.rows[0]!.id;

    await admin.query(
      `insert into memberships (org_id, user_id, role)
       values ($1, $2, 'owner'), ($1, $3, 'viewer')`,
      [org, owner, viewer],
    );
  });

  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it("resolves without throwing when the actor holds an allowed role", async () => {
    await expect(
      withUserContext(owner, (client) => assertRole(client, org, ["owner", "admin"])),
    ).resolves.toBeUndefined();
  });

  it("throws ForbiddenError when the actor's role isn't allowed", async () => {
    await expect(
      withUserContext(viewer, (client) => assertRole(client, org, ["owner", "admin"])),
    ).rejects.toThrow(ForbiddenError);
  });

  it("throws ForbiddenError for a non-member entirely", async () => {
    const stranger = randomUUID();
    await expect(
      withUserContext(stranger, (client) => assertRole(client, org, ["owner", "admin", "member", "viewer"])),
    ).rejects.toThrow(ForbiddenError);
  });
});
