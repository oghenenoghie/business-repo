-- packages/ledger: double-entry accounting engine.
--
-- Deployed into the same database as packages/core (one database per app,
-- per the root README), so it reuses core's current_user_id()/has_org_role()
-- functions. They're recreated here too (identical, `create or replace`) so
-- this package's own tests don't require core's migration to have run first.

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

create or replace function has_org_role(target_org uuid, allowed text[]) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from memberships
    where org_id = target_org
      and user_id = current_user_id()
      and role = any(allowed)
  )
$$;

do $$
begin
  if not exists (select from pg_type where typname = 'account_type') then
    create type account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');
  end if;
end
$$;

-- Accounts form a tree. Leaf accounts hold postings; parents aggregate.
create table accounts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  code       text not null,
  name       text not null,
  type       account_type not null,
  parent_id  uuid references accounts(id),
  currency   text not null,
  is_leaf    boolean not null default true,
  unique (org_id, code)
);

-- A journal entry is one balanced financial event.
create table journal_entries (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  entry_date      date not null,
  description     text not null,
  source          text not null,
  source_id       text,
  idempotency_key text not null,
  reverses_id     uuid references journal_entries(id),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  unique (org_id, idempotency_key)
);

create table journal_lines (
  id         bigserial primary key,
  entry_id   uuid not null references journal_entries(id) on delete restrict,
  account_id uuid not null references accounts(id),
  -- Signed. Debits positive, credits negative. One column, not two: a single
  -- `sum(amount) = 0` check then proves the entry balances, and it is
  -- impossible to write a line that is somehow both.
  amount     bigint not null,
  currency   text not null,
  memo       text
);
create index on journal_lines (account_id);
create index on journal_lines (entry_id);

create or replace function assert_entry_balances() returns trigger
language plpgsql as $$
begin
  if (select sum(amount) from journal_lines where entry_id = new.entry_id) <> 0 then
    raise exception 'journal entry % does not balance', new.entry_id;
  end if;
  return null;
end;
$$;

drop trigger if exists je_balances on journal_lines;
create constraint trigger je_balances
  after insert on journal_lines
  deferrable initially deferred          -- fires at COMMIT, once all lines are in
  for each row execute function assert_entry_balances();

alter table accounts        enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines   enable row level security;

create policy "members read own org accounts" on accounts
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins create accounts" on accounts
  for insert with check (has_org_role(org_id, array['owner', 'admin']));
create policy "owners and admins update accounts" on accounts
  for update using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org journal entries" on journal_entries
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "members post journal entries" on journal_entries
  for insert with check (has_org_role(org_id, array['owner', 'admin', 'member']));
-- No update/delete policy: append-only. Corrections are reversing entries.

create policy "members read own org journal lines" on journal_lines
  for select using (
    exists (
      select 1 from journal_entries je
      where je.id = journal_lines.entry_id
        and has_org_role(je.org_id, array['owner', 'admin', 'member', 'viewer'])
    )
  );
create policy "members post journal lines" on journal_lines
  for insert with check (
    exists (
      select 1 from journal_entries je
      where je.id = journal_lines.entry_id
        and has_org_role(je.org_id, array['owner', 'admin', 'member'])
    )
  );
-- No update/delete policy here either — this is the invariant the whole
-- package exists to protect.

grant select, insert, update on accounts to app_user;
grant select, insert on journal_entries, journal_lines to app_user;
grant usage, select on all sequences in schema public to app_user;
