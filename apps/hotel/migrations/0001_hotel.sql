-- apps/hotel (Portier): properties, inventory, reservations, folios.
--
-- Deployed into the same database as packages/core and packages/ledger (one
-- database per app), so RLS reuses core's has_org_role() and folio charges
-- post through ledger's accounts/journal_entries — see the "Ledger
-- postings" description in .claude/skills/portier-hotel/SKILL.md. A
-- folio's balance is never stored here; it is derived from journal_lines
-- against account 1200 (Guest Folios (AR)).
--
-- The flagship guarantee lives in the `reservations` exclusion constraint
-- below: two confirmed/checked-in reservations for the same room with
-- overlapping stay ranges cannot both exist. No application-layer lock,
-- no race window.

create extension if not exists btree_gist;

-- A hotel group runs several properties under one org.
create table properties (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  name            text not null,
  timezone        text not null default 'Africa/Lagos',
  currency        text not null,
  check_in_time   time not null default '14:00',
  check_out_time  time not null default '12:00',
  created_at      timestamptz not null default now()
);
create index on properties (org_id);

create table room_types (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name        text not null,
  capacity    int not null,
  base_rate   bigint not null,
  created_at  timestamptz not null default now(),
  unique (property_id, name)
);
create index on room_types (property_id);

create table rooms (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id),
  room_type_id uuid not null references room_types(id),
  number       text not null,
  floor        text,
  status       text not null default 'clean'
                  check (status in ('clean', 'dirty', 'inspected', 'out_of_order')),
  created_at   timestamptz not null default now(),
  unique (property_id, number)
);
create index on rooms (property_id);
create index on rooms (room_type_id);

-- Seasons and dynamic pricing are bulk writes to rate_calendar, not a
-- separate "season" abstraction — real-world pricing exceptions don't fit
-- a season model cleanly.
create table rate_plans (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references properties(id),
  room_type_id         uuid not null references room_types(id),
  name                 text not null,
  cancellation_policy  text,
  includes_breakfast   boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (room_type_id, name)
);
create index on rate_plans (property_id);

-- One row per plan per date.
create table rate_calendar (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references properties(id),
  rate_plan_id        uuid not null references rate_plans(id),
  date                date not null,
  rate                bigint not null,
  min_stay            int not null default 1,
  closed_to_arrival   boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (rate_plan_id, date)
);
create index on rate_calendar (property_id);
create index on rate_calendar (rate_plan_id, date);

create table guests (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references properties(id),
  full_name           text not null,
  email               text,
  phone               text,
  id_document_type    text,
  id_document_number  text,
  created_at          timestamptz not null default now()
);
create index on guests (property_id);

do $$
begin
  if not exists (select from pg_type where typname = 'reservation_status') then
    create type reservation_status as enum
      ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');
  end if;
end
$$;

create table reservations (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id),
  room_id       uuid not null references rooms(id),
  guest_id      uuid not null references guests(id),
  rate_plan_id  uuid references rate_plans(id),
  -- Half-open [check_in, check_out) — a checkout and a check-in on the same
  -- day do not overlap. A closed range would block every same-day
  -- turnover, the single most common bug in amateur booking systems.
  stay          daterange not null,
  status        reservation_status not null default 'confirmed',
  source        text not null default 'direct'
                  check (source in ('direct', 'booking_com', 'expedia', 'walk_in')),
  external_id   text,
  created_at    timestamptz not null default now(),

  -- The whole double-booking feature. Two confirmed/checked-in reservations
  -- for the same room with overlapping stays cannot both exist — Postgres
  -- rejects the second INSERT outright. Cancelled/checked-out/no-show
  -- reservations don't hold the room, so cancellation is a status change,
  -- never a delete: history survives and the room frees up immediately.
  exclude using gist (
    room_id with =,
    stay    with &&
  ) where (status in ('confirmed', 'checked_in'))
);
create index on reservations (property_id);
create index on reservations (room_id);
create index on reservations (guest_id);

create table folios (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid not null references reservations(id),
  property_id     uuid not null references properties(id),
  status          text not null default 'open' check (status in ('open', 'closed')),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create index on folios (reservation_id);
create index on folios (property_id);

-- Charges. Debit 1200 Guest Folios (AR), credit 4000 Room Revenue / 4100
-- F&B Revenue / 2500 Tax Payable, depending on the line.
create table folio_lines (
  id                uuid primary key default gen_random_uuid(),
  folio_id          uuid not null references folios(id),
  description       text not null,
  amount            bigint not null,
  posted_at         timestamptz not null default now(),
  journal_entry_id  uuid references journal_entries(id),
  created_at        timestamptz not null default now()
);
create index on folio_lines (folio_id);

-- Credits the folio, debits 1000 Bank. Check-out requires the folio
-- balance (derived from the ledger, never stored) to be zero.
create table payments (
  id                uuid primary key default gen_random_uuid(),
  folio_id          uuid not null references folios(id),
  method            text not null,
  amount            bigint not null,
  reference         text,
  paid_at           timestamptz not null default now(),
  journal_entry_id  uuid references journal_entries(id),
  created_at        timestamptz not null default now()
);
create index on payments (folio_id);

create table housekeeping_tasks (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id),
  property_id   uuid not null references properties(id),
  task_type     text not null default 'clean',
  status        text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  assigned_to   uuid,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index on housekeeping_tasks (property_id);
create index on housekeeping_tasks (room_id);

-- One row per property per business date, keyed for idempotency: the night
-- audit is a batch that will get run twice (retried cron, an impatient
-- night manager), and every posting it makes derives its idempotency key
-- from (property_id, business_date) — re-running is a no-op.
create table night_audit_runs (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references properties(id),
  business_date  date not null,
  status         text not null default 'pending' check (status in ('pending', 'completed')),
  occupancy_pct  numeric(5, 2),
  adr            bigint,
  revpar         bigint,
  run_at         timestamptz,
  created_at     timestamptz not null default now(),
  unique (property_id, business_date)
);
create index on night_audit_runs (property_id);

alter table properties          enable row level security;
alter table room_types          enable row level security;
alter table rooms               enable row level security;
alter table rate_plans          enable row level security;
alter table rate_calendar       enable row level security;
alter table guests              enable row level security;
alter table reservations        enable row level security;
alter table folios              enable row level security;
alter table folio_lines         enable row level security;
alter table payments            enable row level security;
alter table housekeeping_tasks  enable row level security;
alter table night_audit_runs    enable row level security;

create policy "members read own org properties" on properties
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage properties" on properties
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org room types" on room_types
  for select using (
    exists (select 1 from properties p where p.id = room_types.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "owners and admins manage room types" on room_types
  for all using (
    exists (select 1 from properties p where p.id = room_types.property_id
      and has_org_role(p.org_id, array['owner', 'admin']))
  )
  with check (
    exists (select 1 from properties p where p.id = room_types.property_id
      and has_org_role(p.org_id, array['owner', 'admin']))
  );

create policy "members read own org rooms" on rooms
  for select using (
    exists (select 1 from properties p where p.id = rooms.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "owners and admins add rooms" on rooms
  for insert with check (
    exists (select 1 from properties p where p.id = rooms.property_id
      and has_org_role(p.org_id, array['owner', 'admin']))
  );
create policy "members update room status" on rooms
  for update using (
    exists (select 1 from properties p where p.id = rooms.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member']))
  )
  with check (
    exists (select 1 from properties p where p.id = rooms.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member']))
  );

create policy "members read own org rate plans" on rate_plans
  for select using (
    exists (select 1 from properties p where p.id = rate_plans.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "owners and admins manage rate plans" on rate_plans
  for all using (
    exists (select 1 from properties p where p.id = rate_plans.property_id
      and has_org_role(p.org_id, array['owner', 'admin']))
  )
  with check (
    exists (select 1 from properties p where p.id = rate_plans.property_id
      and has_org_role(p.org_id, array['owner', 'admin']))
  );

create policy "members read own org rate calendar" on rate_calendar
  for select using (
    exists (select 1 from properties p where p.id = rate_calendar.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "owners and admins manage rate calendar" on rate_calendar
  for all using (
    exists (select 1 from properties p where p.id = rate_calendar.property_id
      and has_org_role(p.org_id, array['owner', 'admin']))
  )
  with check (
    exists (select 1 from properties p where p.id = rate_calendar.property_id
      and has_org_role(p.org_id, array['owner', 'admin']))
  );

create policy "members read own org guests" on guests
  for select using (
    exists (select 1 from properties p where p.id = guests.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "members manage guests" on guests
  for all using (
    exists (select 1 from properties p where p.id = guests.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member']))
  )
  with check (
    exists (select 1 from properties p where p.id = guests.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member']))
  );

create policy "members read own org reservations" on reservations
  for select using (
    exists (select 1 from properties p where p.id = reservations.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "members manage reservations" on reservations
  for all using (
    exists (select 1 from properties p where p.id = reservations.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member']))
  )
  with check (
    exists (select 1 from properties p where p.id = reservations.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member']))
  );

create policy "members read own org folios" on folios
  for select using (
    exists (select 1 from properties p where p.id = folios.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "members manage folios" on folios
  for all using (
    exists (select 1 from properties p where p.id = folios.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member']))
  )
  with check (
    exists (select 1 from properties p where p.id = folios.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member']))
  );

create policy "members read own org folio lines" on folio_lines
  for select using (
    exists (
      select 1 from folios f join properties p on p.id = f.property_id
      where f.id = folio_lines.folio_id
        and has_org_role(p.org_id, array['owner', 'admin', 'member', 'viewer'])
    )
  );
create policy "members post folio lines" on folio_lines
  for insert with check (
    exists (
      select 1 from folios f join properties p on p.id = f.property_id
      where f.id = folio_lines.folio_id
        and has_org_role(p.org_id, array['owner', 'admin', 'member'])
    )
  );

create policy "members read own org payments" on payments
  for select using (
    exists (
      select 1 from folios f join properties p on p.id = f.property_id
      where f.id = payments.folio_id
        and has_org_role(p.org_id, array['owner', 'admin', 'member', 'viewer'])
    )
  );
create policy "members post payments" on payments
  for insert with check (
    exists (
      select 1 from folios f join properties p on p.id = f.property_id
      where f.id = payments.folio_id
        and has_org_role(p.org_id, array['owner', 'admin', 'member'])
    )
  );

create policy "members read own org housekeeping tasks" on housekeeping_tasks
  for select using (
    exists (select 1 from properties p where p.id = housekeeping_tasks.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "members manage housekeeping tasks" on housekeeping_tasks
  for all using (
    exists (select 1 from properties p where p.id = housekeeping_tasks.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member']))
  )
  with check (
    exists (select 1 from properties p where p.id = housekeeping_tasks.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member']))
  );

create policy "members read own org night audit runs" on night_audit_runs
  for select using (
    exists (select 1 from properties p where p.id = night_audit_runs.property_id
      and has_org_role(p.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "owners and admins manage night audit runs" on night_audit_runs
  for all using (
    exists (select 1 from properties p where p.id = night_audit_runs.property_id
      and has_org_role(p.org_id, array['owner', 'admin']))
  )
  with check (
    exists (select 1 from properties p where p.id = night_audit_runs.property_id
      and has_org_role(p.org_id, array['owner', 'admin']))
  );

grant select, insert, update on
  properties, room_types, rooms, rate_plans, rate_calendar, guests, reservations,
  folios, housekeeping_tasks, night_audit_runs
  to app_user;
grant select, insert on folio_lines, payments to app_user;
grant usage, select on all sequences in schema public to app_user;
