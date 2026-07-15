import { randomUUID } from "node:crypto";
import { seedChartOfAccounts } from "@bp/ledger";
import pg from "pg";
import type { PoolClient } from "pg";

const { Client } = pg;

export function adminClient(): pg.Client {
  return new Client({
    connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_hotel_test",
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

export async function seedHotelChart(client: PoolClient, orgId: string, currency: string): Promise<void> {
  await seedChartOfAccounts(client, orgId, "hotel", currency);
}

export async function createTestProperty(admin: pg.Client, orgId: string, name: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    "insert into properties (org_id, name, currency) values ($1, $2, 'NGN') returning id",
    [orgId, name],
  );
  return result.rows[0]!.id;
}

export async function createTestRoom(admin: pg.Client, propertyId: string, number: string): Promise<string> {
  const roomType = await admin.query<{ id: string }>(
    `insert into room_types (property_id, name, capacity, base_rate) values ($1, 'Standard', 2, 2000000)
     returning id`,
    [propertyId],
  );
  const room = await admin.query<{ id: string }>(
    "insert into rooms (property_id, room_type_id, number) values ($1, $2, $3) returning id",
    [propertyId, roomType.rows[0]!.id, number],
  );
  return room.rows[0]!.id;
}

export async function createTestGuest(admin: pg.Client, propertyId: string, name: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    "insert into guests (property_id, full_name) values ($1, $2) returning id",
    [propertyId, name],
  );
  return result.rows[0]!.id;
}
