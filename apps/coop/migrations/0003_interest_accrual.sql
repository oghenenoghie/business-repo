-- Phase 3: interest accrual. Repayments have always recognized interest
-- income at the moment cash is received (Dr Bank / Cr Interest Income), which
-- is fine for a cash-basis view but understates income earned-but-unpaid at
-- month end. An accrual run recognizes that interest early (Dr Interest
-- Receivable / Cr Interest Income) for installments that have come due but
-- haven't been repaid yet, and marks them so a later repayment credits the
-- receivable instead of double-booking income — see src/interestAccrual.ts
-- and the "Ledger postings" table in .claude/skills/ajo-cooperative/SKILL.md.

alter table repayment_schedules add column accrued_at timestamptz;

create table interest_accrual_runs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  run_date         date not null,
  amount           bigint not null,
  journal_entry_id uuid references journal_entries(id),
  created_at       timestamptz not null default now()
);
create index on interest_accrual_runs (org_id);

alter table interest_accrual_runs enable row level security;

create policy "members read own org interest accrual runs" on interest_accrual_runs
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins record interest accrual runs" on interest_accrual_runs
  for insert with check (has_org_role(org_id, array['owner', 'admin']));

grant select, insert on interest_accrual_runs to app_user;
grant update on repayment_schedules to app_user;

create policy "owners and admins mark schedules accrued" on repayment_schedules
  for update using (
    exists (
      select 1 from loans l
      where l.id = repayment_schedules.loan_id
        and has_org_role(l.org_id, array['owner', 'admin'])
    )
  )
  with check (
    exists (
      select 1 from loans l
      where l.id = repayment_schedules.loan_id
        and has_org_role(l.org_id, array['owner', 'admin'])
    )
  );
