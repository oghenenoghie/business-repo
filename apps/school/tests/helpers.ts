import { randomUUID } from "node:crypto";
import { seedChartOfAccounts } from "@bp/ledger";
import pg from "pg";
import type { PoolClient } from "pg";

const { Client } = pg;

export function adminClient(): pg.Client {
  return new Client({
    connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_school_test",
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

export async function seedSchoolChart(client: PoolClient, orgId: string, currency: string): Promise<void> {
  await seedChartOfAccounts(client, orgId, "school", currency);
}

export async function createTestTerm(admin: pg.Client, orgId: string): Promise<string> {
  const session = await admin.query<{ id: string }>(
    `insert into academic_sessions (org_id, name, start_date, end_date)
     values ($1, '2025/2026', '2025-09-01', '2026-07-31') returning id`,
    [orgId],
  );
  const term = await admin.query<{ id: string }>(
    `insert into terms (org_id, session_id, name, start_date, end_date)
     values ($1, $2, 'first', '2025-09-01', '2025-12-15') returning id`,
    [orgId, session.rows[0]!.id],
  );
  return term.rows[0]!.id;
}

export async function createTestClass(admin: pg.Client, orgId: string, name: string): Promise<string> {
  const result = await admin.query<{ id: string }>("insert into classes (org_id, name) values ($1, $2) returning id", [
    orgId,
    name,
  ]);
  return result.rows[0]!.id;
}

export async function createTestSubject(admin: pg.Client, orgId: string, code: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    "insert into subjects (org_id, name, code) values ($1, $2, $3) returning id",
    [orgId, `Subject ${code}`, code],
  );
  return result.rows[0]!.id;
}

export async function createTestTeacher(admin: pg.Client, orgId: string, name: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    "insert into teachers (org_id, full_name) values ($1, $2) returning id",
    [orgId, name],
  );
  return result.rows[0]!.id;
}

export async function createTestRoom(admin: pg.Client, orgId: string, name: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    "insert into rooms (org_id, name, capacity) values ($1, $2, 30) returning id",
    [orgId, name],
  );
  return result.rows[0]!.id;
}
