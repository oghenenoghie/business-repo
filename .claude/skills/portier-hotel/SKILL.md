---
name: portier-hotel
description: Full project context for Portier — a hotel property management system (reservations, front desk, guest folios, night audit, rate management, OTA channel sync) built on the shared multi-tenant core, double-entry ledger, realtime, and webhook-delivery packages. Use this skill whenever working on Portier in any way — availability and booking, overbooking prevention, room assignment, check-in/check-out, folio postings, the night audit batch, rate plans and seasons, housekeeping status, or channel manager synchronization. Trigger this even when the user doesn't say "Portier" explicitly — any mention of the hotel project, the PMS, reservations or availability or double-booking, guest folios, night audit, RevPAR/ADR/occupancy, OTA or channel sync, or Room/RatePlan/Reservation/Folio entities qualifies. Read this before generating any Portier code, and update the Build State checklist at the end of every session.
---

# Portier — Hotel Property Management System

**Portfolio thesis:** a hotel PMS looks like CRUD until you notice that its central operation — *selling a room for a date range* — is a concurrency problem with real-world consequences. An overbooked hotel at 11pm is an incident, not a bug ticket. This project is where you demonstrate that you can make the database refuse to do the wrong thing.

**One-liner:** *A property management system where the database itself makes double-booking impossible — reservations under an exclusion constraint, guest folios on a double-entry ledger, an idempotent night audit, and OTA channel sync over a retrying webhook pipeline.*

---

## Stack

Next.js 15 · TypeScript strict · Tailwind · shadcn/ui · Postgres

Built on the shared packages:
- **`core`** — tenancy (a hotel group runs several properties), RBAC, audit
- **`ledger`** — guest folios are accounts receivable; every charge is a journal entry
- **`realtime`** — the front-desk board is live across every terminal at reception
- **`delivery`** — OTA channel sync rides the webhook pipeline (signed, retried, circuit-broken)

Read `ledger-core` SKILL.md before writing anything that posts a charge.

---

## The hard part: you cannot sell the same room twice

Two guests hit "book" on the last available room within the same 40ms. The naive implementation —

```ts
const taken = await countOverlapping(roomId, from, to);   // 0
if (taken === 0) await insertReservation(...);            // both threads get here
```

— will cheerfully sell it twice. Read-then-write is not atomic, and no amount of application-layer care fixes it under concurrency.

**Make the database enforce it.** Postgres can refuse an overlapping range outright:

```sql
create extension if not exists btree_gist;

create table reservations (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  room_id     uuid not null references rooms(id),
  guest_id    uuid not null references guests(id),
  stay        daterange not null,          -- [check_in, check_out) — half-open
  status      reservation_status not null default 'confirmed',
  created_at  timestamptz not null default now(),

  -- The whole feature, in four lines. Two confirmed reservations for the same room
  -- with overlapping dates cannot both exist. The second INSERT raises. No lock
  -- held in application code, no race window, no possibility of getting it wrong.
  exclude using gist (
    room_id with =,
    stay    with &&
  ) where (status in ('confirmed', 'checked_in'))
);
```

Note the details, because they are the whole thing:

- **`daterange` is half-open `[in, out)`.** A guest checking out on the 5th and another checking in on the 5th do *not* overlap. Use a closed range and you will block every same-day turnover in the hotel — the single most common bug in amateur booking systems.
- **The `where` clause on the constraint** means cancelled reservations don't block anything, while confirmed and in-house ones do.
- Cancellation is a status change, not a delete — the history survives.

Then handle the exception properly: catch the unique-violation, return a clean "no longer available" to the second guest, and re-render live availability. **Write a test that fires 50 concurrent bookings at one room and asserts exactly one succeeds.** That test is the artifact. Put it in the README.

---

## Night audit — the batch that must be idempotent

Every night the property rolls its business day: post room charges and taxes to every in-house folio, mark no-shows, roll the date, snapshot occupancy statistics.

It will get run twice. The night manager will click it, see nothing happen, and click again. The cron will fire, time out, and retry. **If it isn't idempotent, every in-house guest gets charged twice, and you will find out at breakfast.**

Design it as: for each business date, an audit run has a unique key `(property_id, business_date)`. Every posting it makes carries an idempotency key derived from that. Re-running it is a no-op. This is exactly what `packages/ledger`'s idempotency is for — the ledger refuses the duplicate posting even if the batch logic fails to.

The audit also produces the daily figures the GM actually cares about: **occupancy %, ADR** (average daily rate), and **RevPAR** (revenue per available room = ADR × occupancy). Learn these three terms — using them correctly in a demo is what tells a hotelier you did your homework.

---

## Data model

```
Property ──< RoomType ──< Room
    │           └──< RatePlan ──< RateCalendar   (price per room-type per date)
    │
    ├──< Reservation ──< Folio ──< FolioLine ──> JournalEntry
    │                       └──< Payment
    ├──< Guest
    └──< HousekeepingTask
```

- `properties` — org_id, name, timezone, currency, check_in_time, check_out_time
- `room_types` — property_id, name, capacity, base_rate
- `rooms` — room_type_id, number, floor, status (`clean`|`dirty`|`inspected`|`out_of_order`)
- `rate_plans` — room_type_id, name, cancellation_policy, includes_breakfast
- `rate_calendar` — rate_plan_id, date, rate, min_stay, closed_to_arrival — **one row per plan per date.** Seasons and dynamic pricing are just bulk writes to this table; do not model "seasons" as a separate abstraction, it collapses under real-world exceptions.
- `reservations` — as above, plus `source` (`direct`|`booking_com`|`expedia`|`walk_in`) and `external_id`
- `folios` — reservation_id, status (`open`|`closed`), balance derived from the ledger
- `folio_lines` — folio_id, description, amount, posted_at, journal_entry_id
- `payments` — folio_id, method, amount, reference

**A folio is a ledger account.** Charges debit `1200 Guest Folios (AR)` and credit `4000 Room Revenue` / `2500 Tax Payable`. Payments credit the folio and debit `1000 Bank`. Check-out requires the folio balance to be zero — and that balance is *derived*, never stored. A hotel whose folio balance is a mutable column will, sooner or later, let a guest walk out owing money.

---

## Channel sync (OTA) — where `packages/delivery` earns its place

You list rooms on Booking.com and Expedia. They sell one. You must know within seconds, or you sell it again.

- **Inbound:** OTA pushes a reservation → you accept it, but *availability may already have changed*. This is where the exclusion constraint saves you: if the room is gone, the insert fails and you reject the OTA booking cleanly rather than overbooking.
- **Outbound:** every availability or rate change pushes to each channel. This is a webhook delivery problem — retries, backoff with jitter, circuit-breaking when Expedia's API is down — which is exactly `packages/delivery`.
- **Reconciliation:** a periodic job compares your inventory against each channel's and repairs drift. Push-only sync always drifts. Assume it will.

Being able to explain *why* the sync is retried, idempotent, and reconciled — rather than fire-and-forget — is a senior-level answer to an unglamorous question.

---

## Screens

```
/[property]/board                 front-desk: today's arrivals, departures, in-house (LIVE — realtime)
/[property]/calendar              tape chart: rooms × dates, drag to move a booking
/[property]/reservations/new      availability search → rate → guest → confirm
/[property]/reservations/[id]     stay details, folio, modify, cancel
/[property]/checkin/[id]          assign room, take deposit, register
/[property]/checkout/[id]         folio review, settle, close (balance must be zero)
/[property]/housekeeping          room status board — live for the housekeeping team
/[property]/rates                 rate calendar grid, bulk edit by date range
/[property]/night-audit           run, review, roll the business day
/[property]/reports               occupancy, ADR, RevPAR, source mix, ledger
```

**The tape chart** (rooms down the side, dates across the top, bookings as draggable bars) is the screenshot for the portfolio. It's also where `packages/realtime` shows up: two receptionists moving bookings at once, with presence and optimistic updates.

---

## Build state

**Phase 1 — Inventory & booking**
- [ ] Built on `packages/core` — properties under an org (hotel groups have several)
- [ ] Room types, rooms, rate plans, rate calendar
- [ ] `btree_gist` + the exclusion constraint on `reservations`
- [ ] **Concurrency test: 50 simultaneous bookings on one room → exactly one succeeds**
- [ ] Availability search across a date range
- [ ] Reservation create / modify / cancel (status change, never delete)

**Phase 2 — Front desk**
- [ ] Front-desk board (arrivals / departures / in-house), live via `packages/realtime`
- [ ] Tape chart with drag-to-move
- [ ] Check-in: room assignment, deposit, registration
- [ ] Folio: charges posted through `packages/ledger`
- [ ] Check-out: settle, balance must be zero, close folio
- [ ] Housekeeping board

**Phase 3 — Night audit**
- [ ] Idempotent audit run keyed on `(property_id, business_date)`
- [ ] Room + tax posting to every in-house folio
- [ ] No-show handling, business date roll
- [ ] Daily snapshot: occupancy, ADR, RevPAR
- [ ] **Test: run the audit twice, assert charges posted exactly once**

**Phase 4 — Channels & revenue**
- [ ] Rate calendar bulk edit (seasons = bulk writes, not an abstraction)
- [ ] OTA inbound booking ingestion
- [ ] Outbound availability/rate push via `packages/delivery`
- [ ] Drift reconciliation job
- [ ] Reports: occupancy, ADR, RevPAR, source mix

**Phase 5 — Proof**
- [ ] Seed a demo property: 40 rooms, 6 months of realistic bookings, live arrivals today
- [ ] README leading with the exclusion constraint and the concurrency test
- [ ] Deploy with demo login

## What Patrick needs to provide

- Target market: small independent hotels, or a group with multiple properties? (Changes whether multi-property is core or optional.)
- Whether OTA sync is in scope for v1 — it's the most impressive part and the most work
- A name decision (Portier is a placeholder)
- Ideally: **a front-desk manager to look at the tape chart.** Hoteliers have very strong opinions about tape charts, and they're right.
