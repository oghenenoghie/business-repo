import { randomUUID } from "node:crypto";
import { seedChartOfAccounts } from "@bp/ledger";
import pg from "pg";
import type { PoolClient } from "pg";

const { Client } = pg;

export function adminClient(): pg.Client {
  return new Client({
    connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_payroll_test",
  });
}

export interface TestOrg {
  orgId: string;
  ownerId: string;
}

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

export async function seedPayrollChart(client: PoolClient, orgId: string, currency: string): Promise<void> {
  await seedChartOfAccounts(client, orgId, "payroll", currency);
}
