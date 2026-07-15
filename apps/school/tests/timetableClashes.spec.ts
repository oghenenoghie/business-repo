import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  createTestClass,
  createTestOrg,
  createTestRoom,
  createTestSubject,
  createTestTeacher,
  createTestTerm,
} from "./helpers.js";

const { Pool } = pg;

/**
 * The three hard clash constraints from .claude/skills/termly-school/SKILL.md
 * ("no teacher/room/class can be in two places in one period") are enforced
 * directly by Postgres unique constraints on `timetable_slots`, the same way
 * the hotel's exclusion constraint enforces no-double-booking — the solver
 * (or a manual drag-to-override) cannot write a clashing row, concurrently
 * or otherwise.
 */
describe("timetable clash constraints", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let orgId: string;
  let termId: string;
  let teacherId: string;

  beforeAll(async () => {
    admin = adminClient();
    await admin.connect();

    const org = await createTestOrg(admin, "Clash Test School");
    orgId = org.orgId;
    termId = await createTestTerm(admin, orgId);
    teacherId = await createTestTeacher(admin, orgId, "Mr. Okoro");

    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_school_test",
      max: 55,
    });
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  it("exactly one of 50 concurrent attempts to double-book the same teacher in one period succeeds", async () => {
    // 50 distinct rooms/classes/subjects so only the teacher+day+period
    // collides — isolates the teacher-clash constraint from the other two.
    // Created sequentially: `admin` is a single Client, and concurrent
    // queries on one connection are unsupported (unlike the pooled inserts
    // below, which is the actual concurrency being tested here).
    const combos: { roomId: string; classId: string; subjectId: string }[] = [];
    for (let i = 0; i < 50; i++) {
      combos.push({
        roomId: await createTestRoom(admin, orgId, `Room ${i}`),
        classId: await createTestClass(admin, orgId, `Class ${i}`),
        subjectId: await createTestSubject(admin, orgId, `SUB${i}`),
      });
    }

    const attempts = combos.map((combo) =>
      pool.query(
        `insert into timetable_slots (org_id, term_id, class_id, subject_id, teacher_id, room_id, day_of_week, period_index)
         values ($1, $2, $3, $4, $5, $6, 1, 1)
         returning id`,
        [orgId, termId, combo.classId, combo.subjectId, teacherId, combo.roomId],
      ),
    );

    const results = await Promise.allSettled(attempts);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(49);
    for (const failure of failed) {
      expect(String(failure.reason)).toMatch(/duplicate key value violates unique constraint/i);
    }
  });

  it("rejects a second class in the same room, day, and period (room clash)", async () => {
    const roomId = await createTestRoom(admin, orgId, "Shared Room");
    const classA = await createTestClass(admin, orgId, "Class A");
    const classB = await createTestClass(admin, orgId, "Class B");
    const subjectA = await createTestSubject(admin, orgId, "SUBA");
    const subjectB = await createTestSubject(admin, orgId, "SUBB");
    const teacherA = await createTestTeacher(admin, orgId, "Teacher A");
    const teacherB = await createTestTeacher(admin, orgId, "Teacher B");

    await admin.query(
      `insert into timetable_slots (org_id, term_id, class_id, subject_id, teacher_id, room_id, day_of_week, period_index)
       values ($1, $2, $3, $4, $5, $6, 2, 1)`,
      [orgId, termId, classA, subjectA, teacherA, roomId],
    );

    await expect(
      admin.query(
        `insert into timetable_slots (org_id, term_id, class_id, subject_id, teacher_id, room_id, day_of_week, period_index)
         values ($1, $2, $3, $4, $5, $6, 2, 1)`,
        [orgId, termId, classB, subjectB, teacherB, roomId],
      ),
    ).rejects.toThrow(/duplicate key value violates unique constraint/i);
  });

  it("rejects a second subject for the same class in the same day and period (class clash)", async () => {
    const classId = await createTestClass(admin, orgId, "Busy Class");
    const roomA = await createTestRoom(admin, orgId, "Room A");
    const roomB = await createTestRoom(admin, orgId, "Room B");
    const subjectA = await createTestSubject(admin, orgId, "MATHS");
    const subjectB = await createTestSubject(admin, orgId, "ENG");
    const teacherA = await createTestTeacher(admin, orgId, "Maths Teacher");
    const teacherB = await createTestTeacher(admin, orgId, "English Teacher");

    await admin.query(
      `insert into timetable_slots (org_id, term_id, class_id, subject_id, teacher_id, room_id, day_of_week, period_index)
       values ($1, $2, $3, $4, $5, $6, 3, 1)`,
      [orgId, termId, classId, subjectA, teacherA, roomA],
    );

    await expect(
      admin.query(
        `insert into timetable_slots (org_id, term_id, class_id, subject_id, teacher_id, room_id, day_of_week, period_index)
         values ($1, $2, $3, $4, $5, $6, 3, 1)`,
        [orgId, termId, classId, subjectB, teacherB, roomB],
      ),
    ).rejects.toThrow(/duplicate key value violates unique constraint/i);
  });

  it("allows the same teacher, room, and class in the same period on a different day", async () => {
    const roomId = await createTestRoom(admin, orgId, "Recurring Room");
    const classId = await createTestClass(admin, orgId, "Recurring Class");
    const subjectId = await createTestSubject(admin, orgId, "RECUR");

    await admin.query(
      `insert into timetable_slots (org_id, term_id, class_id, subject_id, teacher_id, room_id, day_of_week, period_index)
       values ($1, $2, $3, $4, $5, $6, 4, 2)`,
      [orgId, termId, classId, subjectId, teacherId, roomId],
    );

    const result = await admin.query(
      `insert into timetable_slots (org_id, term_id, class_id, subject_id, teacher_id, room_id, day_of_week, period_index)
       values ($1, $2, $3, $4, $5, $6, 5, 2)
       returning id`,
      [orgId, termId, classId, subjectId, teacherId, roomId],
    );
    expect(result.rows).toHaveLength(1);
  });
});
