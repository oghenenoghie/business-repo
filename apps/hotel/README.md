# Portier — `apps/hotel`

Property management: reservations, guest folios, night audit. **Cut from the six-day scope**
(see [`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)) — specced, not scheduled yet.

**Status:** database layer only. `migrations/0001_hotel.sql` has the full schema — properties,
room types, rooms, rate plans/calendar, guests, reservations, folios, payments, housekeeping,
and night audit runs — with RLS mirroring `packages/core`'s pattern. The flagship guarantee,
the `reservations` exclusion constraint (`btree_gist`) that makes double-booking a room
impossible at the database level, is proven by a test that fires 50 concurrent bookings at
one room and asserts exactly one succeeds. No application code (availability search, front
desk, night audit, channel sync, UI) yet. Depends on `packages/core` and `packages/ledger`.

```bash
pnpm install
docker compose up -d postgres

pnpm --filter @bp/hotel exec tsx scripts/create-db.ts
pnpm --filter @bp/hotel run migrate   # applies core's, ledger's, then hotel's migrations
pnpm --filter @bp/hotel test          # RLS suite + the 50-concurrent-bookings exclusion test
```

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/portier-hotel/SKILL.md
```
