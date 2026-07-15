-- apps/coop (Ajo): members, savings, loans, guarantors, dividends.
--
-- Deployed into the same database as packages/core and packages/ledger (one
-- database per app), so RLS reuses core's has_org_role() and every financial
-- event posts through ledger's accounts/journal_entries — see the "Ledger
-- postings" table in .claude/skills/ajo-cooperative/SKILL.md. A member's
-- savings balance is never stored here; it is derived from journal_lines
-- against account 2100 (Member Savings).

create table members (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null,
  membership_number    text not null,
  full_name            text not null,
  join_date            date not null,
  status               text not null default 'active'
                          check (status in ('active', 'dormant', 'exited')),
  phone                text,
  email                text,
  bank_name            text,
  bank_account_number  text,
  next_of_kin_name     text,
  next_of_kin_phone    text,
  created_at           timestamptz not null default now(),
  unique (org_id, membership_number)
);
create index on members (org_id);

-- One row per member per month. Posted to the ledger (debit Bank, credit
-- Member Savings) at the same time this row is written.
create table contributions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  member_id        uuid not null references members(id),
  period_year      int not null,
  period_month     int not null check (period_month between 1 and 12),
  amount           bigint not null,
  posted_at        timestamptz not null default now(),
  journal_entry_id uuid references journal_entries(id),
  created_at       timestamptz not null default now(),
  unique (member_id, period_year, period_month)
);
create index on contributions (org_id);

create table share_capital (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  member_id   uuid not null references members(id),
  units       int not null,
  amount      bigint not null,
  acquired_at date not null,
  created_at  timestamptz not null default now()
);
create index on share_capital (org_id);
create index on share_capital (member_id);

create table loans (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  member_id        uuid not null references members(id),
  principal        bigint not null,
  interest_rate    numeric(6, 4) not null,
  tenor_months     int not null,
  method           text not null check (method in ('flat', 'reducing_balance')),
  status           text not null default 'pending'
                      check (status in
                        ('pending', 'approved', 'disbursed', 'active', 'repaid', 'defaulted', 'rescheduled')),
  applied_at       timestamptz not null default now(),
  approved_by      uuid,
  approved_at      timestamptz,
  disbursed_at     timestamptz,
  -- The disbursement journal entry (debit Loans Receivable, credit Bank).
  journal_entry_id uuid references journal_entries(id),
  created_at       timestamptz not null default now()
);
create index on loans (org_id);
create index on loans (member_id);

-- Installments, generated in full at disbursement — never recomputed. A
-- reschedule does not edit these rows; it inserts a new `generation` for the
-- same loan. The active schedule for a loan is the one with the highest
-- generation; earlier generations stay in the table, superseded, for audit.
create table repayment_schedules (
  id             uuid primary key default gen_random_uuid(),
  loan_id        uuid not null references loans(id),
  generation     int not null default 1,
  installment_no int not null,
  due_date       date not null,
  principal_due  bigint not null,
  interest_due   bigint not null,
  created_at     timestamptz not null default now(),
  unique (loan_id, generation, installment_no)
);
create index on repayment_schedules (loan_id, generation, installment_no);

create table repayments (
  id                uuid primary key default gen_random_uuid(),
  loan_id           uuid not null references loans(id),
  schedule_id       uuid references repayment_schedules(id),
  amount            bigint not null,
  principal_portion bigint not null,
  interest_portion  bigint not null,
  paid_at           timestamptz not null default now(),
  -- Splits into two ledger postings: principal (credit Loans Receivable) and
  -- interest (credit Interest Income), both debiting Bank.
  journal_entry_id  uuid references journal_entries(id),
  created_at        timestamptz not null default now()
);
create index on repayments (loan_id);
create index on repayments (schedule_id);

-- A guarantor's own savings are encumbered by amount_guaranteed — the
-- eligibility check (savings x multiplier - outstanding - guaranteed) reads
-- this table by member_id, not just by loan_id.
create table guarantors (
  id                uuid primary key default gen_random_uuid(),
  loan_id           uuid not null references loans(id),
  member_id         uuid not null references members(id),
  amount_guaranteed bigint not null,
  created_at        timestamptz not null default now(),
  unique (loan_id, member_id)
);
create index on guarantors (loan_id);
create index on guarantors (member_id);

create table dividend_runs (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null,
  financial_year        int not null,
  distributable_surplus bigint not null,
  basis                 text not null check (basis in ('savings', 'share_capital', 'patronage')),
  status                text not null default 'draft'
                           check (status in ('draft', 'allocated', 'approved', 'posted')),
  journal_entry_id      uuid references journal_entries(id),
  created_at            timestamptz not null default now(),
  approved_by           uuid,
  approved_at           timestamptz,
  unique (org_id, financial_year)
);
create index on dividend_runs (org_id);

-- allocated is floor(surplus * basis_amount / total_basis), plus the
-- largest-remainder correction on however many members need it so that
-- sum(allocated) over a run equals distributable_surplus exactly.
create table dividend_allocations (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references dividend_runs(id),
  member_id    uuid not null references members(id),
  basis_amount bigint not null,
  allocated    bigint not null,
  created_at   timestamptz not null default now(),
  unique (run_id, member_id)
);
create index on dividend_allocations (run_id);
create index on dividend_allocations (member_id);

alter table members               enable row level security;
alter table contributions         enable row level security;
alter table share_capital         enable row level security;
alter table loans                 enable row level security;
alter table repayment_schedules   enable row level security;
alter table repayments            enable row level security;
alter table guarantors            enable row level security;
alter table dividend_runs         enable row level security;
alter table dividend_allocations  enable row level security;

create policy "members read own org members" on members
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage members" on members
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org contributions" on contributions
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "members post contributions" on contributions
  for insert with check (has_org_role(org_id, array['owner', 'admin', 'member']));
-- No update/delete policy: append-only, same as the ledger.

create policy "members read own org share capital" on share_capital
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins record share capital" on share_capital
  for insert with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org loans" on loans
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage loans" on loans
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org repayment schedules" on repayment_schedules
  for select using (
    exists (
      select 1 from loans l
      where l.id = repayment_schedules.loan_id
        and has_org_role(l.org_id, array['owner', 'admin', 'member', 'viewer'])
    )
  );
create policy "owners and admins generate repayment schedules" on repayment_schedules
  for insert with check (
    exists (
      select 1 from loans l
      where l.id = repayment_schedules.loan_id
        and has_org_role(l.org_id, array['owner', 'admin'])
    )
  );

create policy "members read own org repayments" on repayments
  for select using (
    exists (
      select 1 from loans l
      where l.id = repayments.loan_id
        and has_org_role(l.org_id, array['owner', 'admin', 'member', 'viewer'])
    )
  );
create policy "members post repayments" on repayments
  for insert with check (
    exists (
      select 1 from loans l
      where l.id = repayments.loan_id
        and has_org_role(l.org_id, array['owner', 'admin', 'member'])
    )
  );

create policy "members read own org guarantors" on guarantors
  for select using (
    exists (
      select 1 from loans l
      where l.id = guarantors.loan_id
        and has_org_role(l.org_id, array['owner', 'admin', 'member', 'viewer'])
    )
  );
create policy "owners and admins record guarantors" on guarantors
  for insert with check (
    exists (
      select 1 from loans l
      where l.id = guarantors.loan_id
        and has_org_role(l.org_id, array['owner', 'admin'])
    )
  );

create policy "members read own org dividend runs" on dividend_runs
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage dividend runs" on dividend_runs
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org dividend allocations" on dividend_allocations
  for select using (
    exists (
      select 1 from dividend_runs dr
      where dr.id = dividend_allocations.run_id
        and has_org_role(dr.org_id, array['owner', 'admin', 'member', 'viewer'])
    )
  );
create policy "owners and admins write dividend allocations" on dividend_allocations
  for insert with check (
    exists (
      select 1 from dividend_runs dr
      where dr.id = dividend_allocations.run_id
        and has_org_role(dr.org_id, array['owner', 'admin'])
    )
  );

grant select, insert, update on members, loans, dividend_runs to app_user;
grant select, insert on contributions, share_capital to app_user;
grant select, insert on repayment_schedules, repayments, guarantors, dividend_allocations to app_user;
grant usage, select on all sequences in schema public to app_user;
