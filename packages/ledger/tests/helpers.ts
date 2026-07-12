import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;

export function adminClient(): pg.Client {
  return new Client({
    connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_ledger_test",
  });
}

export interface TestOrg {
  orgId: string;
  ownerId: string;
}

/** Creates an org with a single owner membership, via the admin connection (bypasses RLS, as table owner). */
export async function createTestOrg(admin: pg.Client, name: string): Promise<TestOrg> {
  const ownerId = randomUUID();
  const orgResult = await admin.query<{ id: string }>(
    "insert into organizations (name, slug) values ($1, $2) returning id",
    [name, `${name.toLowerCase().replace(/\s+/g, "-")}-${randomUUID()}`],
  );
  const orgId = orgResult.rows[0]!.id;
  await admin.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')", [orgId, ownerId]);
  return { orgId, ownerId };
}

export async function createAccount(
  admin: pg.Client,
  orgId: string,
  code: string,
  name: string,
  type: "asset" | "liability" | "equity" | "revenue" | "expense",
  currency: string,
): Promise<void> {
  await admin.query(
    `insert into accounts (org_id, code, name, type, currency) values ($1, $2, $3, $4, $5)
     on conflict (org_id, code) do nothing`,
    [orgId, code, name, type, currency],
  );
}
