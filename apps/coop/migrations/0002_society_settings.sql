-- Per-society loan eligibility settings. Multiplier varies by society bylaws
-- (2x or 3x savings is common, per .claude/skills/ajo-cooperative/SKILL.md),
-- so it's a row here rather than a hardcoded constant. Read by
-- src/loans.ts's eligibility engine on every application, approval, and
-- guarantor check — and by the /loans/new screen's live eligibility check.
create table society_settings (
  org_id             uuid primary key references organizations(id),
  savings_multiplier numeric(4, 2) not null default 2.00 check (savings_multiplier > 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table society_settings enable row level security;

create policy "members read own org settings" on society_settings
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage settings" on society_settings
  for insert with check (has_org_role(org_id, array['owner', 'admin']));
create policy "owners and admins update settings" on society_settings
  for update using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

grant select, insert, update on society_settings to app_user;
