# Termly — `apps/school`

School management: timetabling, CBT exams, fees. **Cut from the six-day scope** (see
[`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)) — specced, not scheduled yet.

**Status:** database layer only. `migrations/0001_school.sql` has the full schema — academic
sessions/terms, classes, subjects, teachers, students, guardians, enrollment, attendance,
the solved timetable, assessments/scores, grading scales, and fee structures/invoices — with
RLS mirroring `packages/core`'s pattern. The three hard timetable clash constraints (no
teacher, room, or class double-booked in one period) are enforced directly by Postgres unique
constraints on `timetable_slots`, proven by a test that fires 50 concurrent attempts to
double-book one teacher and asserts exactly one succeeds, plus direct checks for the room and
class clash constraints. No application code (the timetable solver itself, CBT exam engine,
fee application logic, UI) yet. Depends on `packages/core` and `packages/ledger`.

```bash
pnpm install
docker compose up -d postgres

pnpm --filter @bp/school exec tsx scripts/create-db.ts
pnpm --filter @bp/school run migrate  # applies core's, ledger's, then school's migrations
pnpm --filter @bp/school test         # RLS suite + timetable clash-constraint tests
```

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/termly-school/SKILL.md
```
