-- apps/school (Termly): sessions/terms, students, timetabling, assessment,
-- and fees.
--
-- Deployed into the same database as packages/core and packages/ledger (one
-- database per app), so RLS reuses core's has_org_role() and fee invoices
-- post through ledger's accounts/journal_entries — see
-- .claude/skills/termly-school/SKILL.md. A student's fee balance is never
-- stored here; it is derived from journal_lines against account 1200
-- (Student Receivable).
--
-- Everything below sessions/terms is scoped to a term — Nigerian schools
-- run three terms, and results/fees/attendance/timetables all reset per
-- term. That boundary is in the schema from the start, not bolted on later.
--
-- The timetabling flagship (see the skill's "hard part" section) is a
-- solver problem, not a schema problem, but the three hard clash
-- constraints it must respect — no teacher, room, or class double-booked in
-- one period — are enforced directly by Postgres below, the same way the
-- hotel's exclusion constraint enforces no-double-booking: the solver (or
-- any manual edit) simply cannot insert a clashing slot.

create table academic_sessions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  name       text not null, -- e.g. '2025/2026'
  start_date date not null,
  end_date   date not null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create index on academic_sessions (org_id);

create table terms (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  session_id uuid not null references academic_sessions(id),
  name       text not null check (name in ('first', 'second', 'third')),
  start_date date not null,
  end_date   date not null,
  created_at timestamptz not null default now(),
  unique (session_id, name)
);
create index on terms (org_id);
create index on terms (session_id);

create table classes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  name       text not null, -- e.g. 'JSS1A'
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create index on classes (org_id);

create table subjects (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  name       text not null,
  code       text not null,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);
create index on subjects (org_id);

create table teachers (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  full_name  text not null,
  email      text,
  phone      text,
  created_at timestamptz not null default now()
);
create index on teachers (org_id);

create table teacher_subjects (
  teacher_id uuid not null references teachers(id),
  subject_id uuid not null references subjects(id),
  created_at timestamptz not null default now(),
  primary key (teacher_id, subject_id)
);

-- A solver input: which (day, period) slots a teacher is available for.
create table teacher_availability (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null references teachers(id),
  day_of_week  int not null check (day_of_week between 0 and 6),
  period_index int not null,
  created_at   timestamptz not null default now(),
  unique (teacher_id, day_of_week, period_index)
);
create index on teacher_availability (teacher_id);

create table rooms (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  name       text not null,
  capacity   int not null,
  room_type  text not null default 'classroom'
               check (room_type in ('classroom', 'lab', 'computer_room')),
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create index on rooms (org_id);

create table students (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  admission_number  text not null,
  full_name         text not null,
  date_of_birth     date,
  gender            text,
  created_at        timestamptz not null default now(),
  unique (org_id, admission_number)
);
create index on students (org_id);

create table guardians (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  full_name  text not null,
  phone      text,
  email      text,
  created_at timestamptz not null default now()
);
create index on guardians (org_id);

create table student_guardians (
  student_id   uuid not null references students(id),
  guardian_id  uuid not null references guardians(id),
  relationship text,
  created_at   timestamptz not null default now(),
  primary key (student_id, guardian_id)
);

create table enrollments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  student_id uuid not null references students(id),
  class_id   uuid not null references classes(id),
  term_id    uuid not null references terms(id),
  status     text not null default 'active' check (status in ('active', 'withdrawn', 'graduated')),
  created_at timestamptz not null default now(),
  unique (student_id, term_id)
);
create index on enrollments (org_id);
create index on enrollments (class_id, term_id);

create table attendance (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  student_id uuid not null references students(id),
  term_id    uuid not null references terms(id),
  date       date not null,
  status     text not null check (status in ('present', 'absent', 'late', 'excused')),
  created_at timestamptz not null default now(),
  unique (student_id, date)
);
create index on attendance (org_id);
create index on attendance (term_id, date);

-- The solved timetable. The three unique constraints below are the hard
-- clash constraints, enforced by Postgres itself: no teacher, room, or
-- class can hold two slots in the same (term, day, period) — the solver
-- (or a manual drag-to-override) simply cannot write a clashing row.
create table timetable_slots (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  term_id       uuid not null references terms(id),
  class_id      uuid not null references classes(id),
  subject_id    uuid not null references subjects(id),
  teacher_id    uuid not null references teachers(id),
  room_id       uuid not null references rooms(id),
  day_of_week   int not null check (day_of_week between 0 and 6),
  period_index  int not null,
  created_at    timestamptz not null default now(),
  unique (term_id, teacher_id, day_of_week, period_index), -- teacher clash
  unique (term_id, room_id, day_of_week, period_index),    -- room clash
  unique (term_id, class_id, day_of_week, period_index)    -- class clash
);
create index on timetable_slots (org_id);

create table assessments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  term_id    uuid not null references terms(id),
  subject_id uuid not null references subjects(id),
  class_id   uuid not null references classes(id),
  name       text not null, -- e.g. 'CA1', 'CA2', 'Exam'
  weight     numeric(5, 2) not null,
  max_score  numeric(6, 2) not null,
  created_at timestamptz not null default now()
);
create index on assessments (org_id);
create index on assessments (term_id, class_id, subject_id);

create table scores (
  id            uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id),
  student_id    uuid not null references students(id),
  score         numeric(6, 2) not null,
  created_at    timestamptz not null default now(),
  unique (assessment_id, student_id)
);
create index on scores (assessment_id);
create index on scores (student_id);

-- Effective-dated per session — grade boundaries differ by school and
-- change over time, so this is never hardcoded.
create table grading_scales (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  session_id uuid not null references academic_sessions(id),
  name       text not null,
  created_at timestamptz not null default now()
);
create index on grading_scales (org_id);

create table grade_bands (
  id                uuid primary key default gen_random_uuid(),
  grading_scale_id  uuid not null references grading_scales(id),
  grade             text not null,
  min_score         numeric(5, 2) not null,
  max_score         numeric(5, 2) not null,
  created_at        timestamptz not null default now()
);
create index on grade_bands (grading_scale_id);

create table fee_structures (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  class_id   uuid not null references classes(id),
  term_id    uuid not null references terms(id),
  name       text not null,
  amount     bigint not null,
  created_at timestamptz not null default now()
);
create index on fee_structures (org_id);
create index on fee_structures (class_id, term_id);

-- Dr 1200 Student Receivable, Cr 4000 Tuition Revenue / 4100 Levy Revenue.
create table invoices (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  student_id        uuid not null references students(id),
  term_id           uuid not null references terms(id),
  amount            bigint not null,
  status            text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid')),
  journal_entry_id  uuid references journal_entries(id),
  created_at        timestamptz not null default now()
);
create index on invoices (org_id);
create index on invoices (student_id, term_id);

create table invoice_lines (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references invoices(id),
  fee_structure_id  uuid references fee_structures(id),
  description       text not null,
  -- Negative for a waiver/scholarship credit note, so sum(amount) over an
  -- invoice's lines always equals the invoice total exactly.
  amount            bigint not null,
  created_at        timestamptz not null default now()
);
create index on invoice_lines (invoice_id);

-- Credits the invoice/receivable, debits 1000 Bank.
create table payments (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references invoices(id),
  amount            bigint not null,
  method            text not null,
  reference         text,
  paid_at           timestamptz not null default now(),
  journal_entry_id  uuid references journal_entries(id),
  created_at        timestamptz not null default now()
);
create index on payments (invoice_id);

alter table academic_sessions  enable row level security;
alter table terms              enable row level security;
alter table classes            enable row level security;
alter table subjects           enable row level security;
alter table teachers           enable row level security;
alter table teacher_subjects   enable row level security;
alter table teacher_availability enable row level security;
alter table rooms              enable row level security;
alter table students           enable row level security;
alter table guardians          enable row level security;
alter table student_guardians  enable row level security;
alter table enrollments        enable row level security;
alter table attendance         enable row level security;
alter table timetable_slots    enable row level security;
alter table assessments        enable row level security;
alter table scores             enable row level security;
alter table grading_scales     enable row level security;
alter table grade_bands        enable row level security;
alter table fee_structures     enable row level security;
alter table invoices           enable row level security;
alter table invoice_lines      enable row level security;
alter table payments           enable row level security;

create policy "members read own org academic sessions" on academic_sessions
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage academic sessions" on academic_sessions
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org terms" on terms
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage terms" on terms
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org classes" on classes
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage classes" on classes
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org subjects" on subjects
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage subjects" on subjects
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org teachers" on teachers
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage teachers" on teachers
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org teacher subjects" on teacher_subjects
  for select using (
    exists (select 1 from teachers t where t.id = teacher_subjects.teacher_id
      and has_org_role(t.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "owners and admins assign teacher subjects" on teacher_subjects
  for insert with check (
    exists (select 1 from teachers t where t.id = teacher_subjects.teacher_id
      and has_org_role(t.org_id, array['owner', 'admin']))
  );

create policy "members read own org teacher availability" on teacher_availability
  for select using (
    exists (select 1 from teachers t where t.id = teacher_availability.teacher_id
      and has_org_role(t.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "owners and admins set teacher availability" on teacher_availability
  for insert with check (
    exists (select 1 from teachers t where t.id = teacher_availability.teacher_id
      and has_org_role(t.org_id, array['owner', 'admin']))
  );

create policy "members read own org rooms" on rooms
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage rooms" on rooms
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org students" on students
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage students" on students
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org guardians" on guardians
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage guardians" on guardians
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org student guardians" on student_guardians
  for select using (
    exists (select 1 from students s where s.id = student_guardians.student_id
      and has_org_role(s.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "owners and admins link student guardians" on student_guardians
  for insert with check (
    exists (select 1 from students s where s.id = student_guardians.student_id
      and has_org_role(s.org_id, array['owner', 'admin']))
  );

create policy "members read own org enrollments" on enrollments
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage enrollments" on enrollments
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org attendance" on attendance
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "members take attendance" on attendance
  for all using (has_org_role(org_id, array['owner', 'admin', 'member']))
  with check (has_org_role(org_id, array['owner', 'admin', 'member']));

create policy "members read own org timetable slots" on timetable_slots
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage timetable slots" on timetable_slots
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org assessments" on assessments
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "members manage assessments" on assessments
  for all using (has_org_role(org_id, array['owner', 'admin', 'member']))
  with check (has_org_role(org_id, array['owner', 'admin', 'member']));

create policy "members read own org scores" on scores
  for select using (
    exists (select 1 from assessments a where a.id = scores.assessment_id
      and has_org_role(a.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "members enter scores" on scores
  for all using (
    exists (select 1 from assessments a where a.id = scores.assessment_id
      and has_org_role(a.org_id, array['owner', 'admin', 'member']))
  )
  with check (
    exists (select 1 from assessments a where a.id = scores.assessment_id
      and has_org_role(a.org_id, array['owner', 'admin', 'member']))
  );

create policy "members read own org grading scales" on grading_scales
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage grading scales" on grading_scales
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org grade bands" on grade_bands
  for select using (
    exists (select 1 from grading_scales gs where gs.id = grade_bands.grading_scale_id
      and has_org_role(gs.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "owners and admins manage grade bands" on grade_bands
  for all using (
    exists (select 1 from grading_scales gs where gs.id = grade_bands.grading_scale_id
      and has_org_role(gs.org_id, array['owner', 'admin']))
  )
  with check (
    exists (select 1 from grading_scales gs where gs.id = grade_bands.grading_scale_id
      and has_org_role(gs.org_id, array['owner', 'admin']))
  );

create policy "members read own org fee structures" on fee_structures
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "owners and admins manage fee structures" on fee_structures
  for all using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members read own org invoices" on invoices
  for select using (has_org_role(org_id, array['owner', 'admin', 'member', 'viewer']));
create policy "members manage invoices" on invoices
  for all using (has_org_role(org_id, array['owner', 'admin', 'member']))
  with check (has_org_role(org_id, array['owner', 'admin', 'member']));

create policy "members read own org invoice lines" on invoice_lines
  for select using (
    exists (select 1 from invoices i where i.id = invoice_lines.invoice_id
      and has_org_role(i.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "members post invoice lines" on invoice_lines
  for insert with check (
    exists (select 1 from invoices i where i.id = invoice_lines.invoice_id
      and has_org_role(i.org_id, array['owner', 'admin', 'member']))
  );

create policy "members read own org fee payments" on payments
  for select using (
    exists (select 1 from invoices i where i.id = payments.invoice_id
      and has_org_role(i.org_id, array['owner', 'admin', 'member', 'viewer']))
  );
create policy "members post fee payments" on payments
  for insert with check (
    exists (select 1 from invoices i where i.id = payments.invoice_id
      and has_org_role(i.org_id, array['owner', 'admin', 'member']))
  );

grant select, insert, update on
  academic_sessions, terms, classes, subjects, teachers, rooms, students, guardians,
  enrollments, attendance, timetable_slots, assessments, scores, grading_scales,
  fee_structures, invoices
  to app_user;
grant select, insert on
  teacher_subjects, teacher_availability, student_guardians, grade_bands, invoice_lines, payments
  to app_user;
grant usage, select on all sequences in schema public to app_user;
