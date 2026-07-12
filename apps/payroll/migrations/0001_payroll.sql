-- apps/payroll: employees, effective-dated employment records, payroll runs.
--
-- Deployed into the same database as packages/core and packages/ledger (one
-- database per app), so RLS reuses core's has_org_role() and payroll runs
-- post through ledger's accounts/journal_entries.

create table employees (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  staff_number       text not null,
  full_name          text not null,
  nationality        text not null,
  employee_type      text not null default 'full_time',
  pension_opt_in     boolean not null default true,
  nhf_opt_in         boolean not null default false,
  hire_date          date not null,
  termination_date   date,
  created_at         timestamptz not null default now(),
  unique (org_id, staff_number)
);

-- Effective-dated. A raise is a new row, never an UPDATE. Payroll for a
-- given period reads the record with the latest effective_from <= that
-- period's first day.
create table employment_records (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  employee_id    uuid not null references employees(id),
  effective_from date not null,
  basic          bigint not null,
  housing        bigint not null default 0,
  transport      bigint not null default 0,
  annual_rent    bigint not null default 0,
  currency       text not null,
  created_at     timestamptz not null default now(),
  unique (employee_id, effective_from)
);
create index on employment_records (employee_id, effective_from desc);

create table payroll_runs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  period            text not null, -- 'YYYY-MM'
  jurisdiction      text not null,
  rule_set_version  text not null,
  status            text not null default 'draft'
                       check (status in ('draft', 'calculated', 'approved', 'posted')),
  journal_entry_id  uuid references journal_entries(id),
  created_at        timestamptz not null default now(),
  approved_by       uuid,
  approved_at       timestamptz,
  unique (org_id, period, jurisdiction)
);

create table payslips (
  id                          uuid primary key default gen_random_uuid(),
  run_id                      uuid not null references payroll_runs(id),
  employee_id                 uuid not null references employees(id),
  gross                       bigint not null,
  total_deductions            bigint not null,
  total_employer_liabilities  bigint not null,
  net                         bigint not null,
  -- Frozen copy of everything the calculation depended on, so re-running
  -- this payslip in 2030 reproduces the same figures even if the employee
  -- record has since changed.
  employee_snapshot           jsonb not null,
  created_at                  timestamptz not null default now(),
  unique (run_id, employee_id)
);

create table payslip_lines (
  id         bigserial primary key,
  payslip_id uuid not null references payslips(id),
  code       text not null,
  name       text not null,
  type       text not null,
  amount     bigint not null
);
create index on payslip_lines (payslip_id);

alter table employees          enable row level security;
alter table employment_records enable row level security;
alter table payroll_runs       enable row level security;
alter table payslips           enable row level security;
alter table payslip_lines      enable row level security;

create policy "members read own org employees" on employees
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage employees" on employees
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org employment records" on employment_records
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins create employment records" on employment_records
  for insert with check (has_org_role(org_id, array['owner', 'admin']));
-- No update/delete policy: effective-dated, append-only, same as the ledger.

create policy "members read own org payroll runs" on payroll_runs
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "members manage payroll runs" on payroll_runs
  for all using (has_org_role(org_id, array['owner', 'admin', 'member']))
  with check (has_org_role(org_id, array['owner', 'admin', 'member']));

create policy "members read own org payslips" on payslips
  for select using (
    exists (
      select 1 from payroll_runs pr
      where pr.id = payslips.run_id
        and has_org_role(pr.org_id, array['owner', 'admin', 'member', 'viewer'])
    )
  );
create policy "members write payslips" on payslips
  for insert with check (
    exists (
      select 1 from payroll_runs pr
      where pr.id = payslips.run_id
        and has_org_role(pr.org_id, array['owner', 'admin', 'member'])
    )
  );

create policy "members read own org payslip lines" on payslip_lines
  for select using (
    exists (
      select 1 from payslips p
      join payroll_runs pr on pr.id = p.run_id
      where p.id = payslip_lines.payslip_id
        and has_org_role(pr.org_id, array['owner', 'admin', 'member', 'viewer'])
    )
  );
create policy "members write payslip lines" on payslip_lines
  for insert with check (
    exists (
      select 1 from payslips p
      join payroll_runs pr on pr.id = p.run_id
      where p.id = payslip_lines.payslip_id
        and has_org_role(pr.org_id, array['owner', 'admin', 'member'])
    )
  );

grant select, insert on employees, employment_records to app_user;
grant select, insert, update on payroll_runs to app_user;
grant select, insert on payslips, payslip_lines to app_user;
grant usage, select on all sequences in schema public to app_user;
