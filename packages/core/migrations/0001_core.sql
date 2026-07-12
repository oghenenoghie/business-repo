-- packages/core: tenancy, RBAC, audit log foundation.
--
-- Identity for row-level security comes from an application-set session
-- variable (`app.current_user_id`), not Supabase's `auth.uid()` — this
-- monorepo targets a plain, self-hosted Postgres on the VPS, not Supabase
-- cloud. `withUserContext()` in src/db.ts sets it per transaction.

do $$
begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user login nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end
$$;

create or replace function current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

create table memberships (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null,
  role       text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table audit_events (
  id          bigserial primary key,
  org_id      uuid not null references organizations(id) on delete cascade,
  actor_id    uuid,
  action      text not null,
  target_type text,
  target_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index on audit_events (org_id, created_at desc);

-- Single place the role check lives, so every policy and every
-- application-layer assertRole() call resolves membership the same way.
create or replace function has_org_role(target_org uuid, allowed text[]) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from memberships
    where org_id = target_org
      and user_id = current_user_id()
      and role = any(allowed)
  )
$$;

alter table organizations enable row level security;
alter table memberships   enable row level security;
alter table audit_events  enable row level security;

-- organizations: readable by members. Any authenticated session may create
-- one — they become owner in the same transaction via the "first member
-- becomes owner" membership policy below.
create policy "members read own orgs" on organizations
  for select using (has_org_role(id, array['owner', 'admin', 'member', 'viewer']));

create policy "authenticated sessions create orgs" on organizations
  for insert with check (current_user_id() is not null);

-- memberships: readable by any member of the org. Writable by owner/admin,
-- OR by the session claiming the very first (owner) seat on a new org —
-- permissive policies are OR'd, so either condition is enough.
create policy "members read own org memberships" on memberships
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));

create policy "owners and admins manage memberships" on memberships
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "first member becomes owner" on memberships
  for insert with check (
    user_id = current_user_id()
    and role = 'owner'
    and not exists (select 1 from memberships m where m.org_id = memberships.org_id)
  );

-- audit_events: append-only, no update/delete policy exists for it at all.
-- Any member can write an entry (mutations log themselves); only members
-- read.
create policy "members read own org audit events" on audit_events
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));

create policy "members write audit events" on audit_events
  for insert with check (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));

grant select, insert, update, delete on organizations, memberships to app_user;
grant select, insert on audit_events to app_user;
grant usage, select on all sequences in schema public to app_user;
