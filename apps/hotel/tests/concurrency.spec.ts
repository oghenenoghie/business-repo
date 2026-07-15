import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, createTestGuest, createTestOrg, createTestProperty, createTestRoom } from "./helpers.js";

const { Pool } = pg;

/**
 * The flagship guarantee (see .claude/skills/portier-hotel/SKILL.md): two
 * confirmed reservations for the same room with overlapping stays cannot
 * both exist. This fires 50 real concurrent bookings (separate pooled
 * connections, not one connection issuing 50 sequential queries) at one
 * room and asserts exactly one succeeds — the exclusion constraint on
 * `reservations` in migrations/0001_hotel.sql is what makes that true, not
 * application-layer locking.
 */
describe("reservation exclusion constraint", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let roomId: string;
  let guestId: string;

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();

    const org = await createTestOrg(admin, "Concurrency Test Hotel");
    const propertyId = await createTestProperty(admin, org.orgId, "Test Property");
    roomId = await createTestRoom(admin, propertyId, "101");
    guestId = await createTestGuest(admin, propertyId, "Concurrent Guest");

    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_hotel_test",
      max: 55,
    });
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  it("exactly one of 50 concurrent overlapping bookings succeeds", async () => {
    const attempts = Array.from({ length: 50 }, () =>
      pool.query(
        `insert into reservations (property_id, room_id, guest_id, stay, status)
         select property_id, $1, $2, daterange('2026-08-01', '2026-08-05'), 'confirmed'
         from rooms where id = $1
         returning id`,
        [roomId, guestId],
      ),
    );

    const results = await Promise.allSettled(attempts);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(49);
    for (const failure of failed) {
      expect(String(failure.reason)).toMatch(/exclusion/i);
    }
  });

  it("a non-overlapping stay on the same room succeeds", async () => {
    const result = await admin.query(
      `insert into reservations (property_id, room_id, guest_id, stay, status)
       select property_id, $1, $2, daterange('2026-09-01', '2026-09-05'), 'confirmed'
       from rooms where id = $1
       returning id`,
      [roomId, guestId],
    );
    expect(result.rows).toHaveLength(1);
  });

  it("a same-day turnover (checkout date = next check-in date) does not conflict", async () => {
    const first = await admin.query(
      `insert into reservations (property_id, room_id, guest_id, stay, status)
       select property_id, $1, $2, daterange('2026-10-01', '2026-10-05'), 'confirmed'
       from rooms where id = $1
       returning id`,
      [roomId, guestId],
    );
    expect(first.rows).toHaveLength(1);

    const turnover = await admin.query(
      `insert into reservations (property_id, room_id, guest_id, stay, status)
       select property_id, $1, $2, daterange('2026-10-05', '2026-10-08'), 'confirmed'
       from rooms where id = $1
       returning id`,
      [roomId, guestId],
    );
    expect(turnover.rows).toHaveLength(1);
  });

  it("a cancelled reservation does not block a new booking for the same dates", async () => {
    const first = await admin.query<{ id: string }>(
      `insert into reservations (property_id, room_id, guest_id, stay, status)
       select property_id, $1, $2, daterange('2026-11-01', '2026-11-05'), 'confirmed'
       from rooms where id = $1
       returning id`,
      [roomId, guestId],
    );
    await admin.query("update reservations set status = 'cancelled' where id = $1", [first.rows[0]!.id]);

    const rebooked = await admin.query(
      `insert into reservations (property_id, room_id, guest_id, stay, status)
       select property_id, $1, $2, daterange('2026-11-01', '2026-11-05'), 'confirmed'
       from rooms where id = $1
       returning id`,
      [roomId, guestId],
    );
    expect(rebooked.rows).toHaveLength(1);
  });
});
