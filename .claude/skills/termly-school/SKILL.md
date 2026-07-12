---
name: termly-school
description: Full project context for Termly — a school management system (automatic timetable generation, CBT exam engine, results and grading, fee billing and reconciliation, attendance, parent portal) built on the shared multi-tenant core, ledger, realtime, and analytics packages. Use this skill whenever working on Termly in any way — the timetable constraint solver, exam delivery, grading and report cards, fee schedules and invoicing, attendance, or the parent/student portals. Trigger this even when the user doesn't say "Termly" explicitly — any mention of the school project, timetabling or scheduling conflicts, CBT or computer-based testing, report cards or term results, school fees, or Student/Class/Subject/Timetable/Assessment entities qualifies. Read this before generating any Termly code, and update the Build State checklist at the end of every session.
---

# Termly — School Management System

**Portfolio thesis:** most school systems are CRUD. This one has a genuine computer-science core — **timetable generation is a constraint satisfaction problem**, and a working auto-timetabler is something most senior developers could not produce on demand. Around it sits a fee ledger and an exam engine that has to be correct under exam conditions.

**Commercial thesis:** it's the same market as IFS LMS, which is already a real client. The domain credibility carries over.

**One-liner:** *School management with an automatic timetable generator — a constraint solver that respects teacher availability, room capacity, subject period quotas, and double-booking, plus a CBT exam engine and a fee ledger that reconciles.*

---

## Stack

Next.js 15 · TypeScript strict · Tailwind · shadcn/ui · Postgres
Built on **`core`** (multi-school tenancy, RBAC, audit), **`ledger`** (fees), **`realtime`** (live exam monitoring), **`analytics`** (performance dashboards).

---

## The hard part: timetable generation

Given:
- teachers, each with availability windows and a subject they teach
- classes (e.g. JSS1A … SSS3C), each needing a fixed number of periods per subject per week
- rooms, some specialised (labs, computer rooms) with capacity limits
- a weekly grid of periods

Produce an assignment such that **no hard constraint is violated**:

| Hard constraint | Meaning |
|---|---|
| Teacher clash | A teacher cannot be in two places in one period |
| Class clash | A class cannot have two subjects in one period |
| Room clash | A room cannot hold two classes in one period |
| Room suitability | Chemistry needs a lab; a lab has capacity |
| Period quota | Each subject gets exactly its required periods per week |
| Availability | Nobody is scheduled outside their availability |

And *softly* optimise: minimise teacher gaps, spread a subject across the week rather than stacking it, avoid double-period maths on Friday afternoon, respect preferred slots.

### How to actually build it

**Do not write a naive backtracker and hope.** It will work on your five-class test fixture and hang forever on a real school with 30 classes.

Approach in order:
1. **Model it properly.** Variables = (class, subject, period-index). Domains = (timeslot, teacher, room).
2. **Constraint propagation + backtracking with heuristics** — most-constrained-variable first, least-constraining-value. This alone solves most real schools.
3. **If it stalls, switch to local search:** generate a valid-ish assignment, then hill-climb / simulated-annealing on a cost function that weights hard violations infinitely and soft violations finitely. This is how commercial timetablers actually work, and it degrades gracefully — you always have *an* answer, just a better or worse one.
4. **Always show your work.** If it can't find a feasible solution, report *which* constraint is unsatisfiable ("JSS2 needs 6 physics periods but Mr. Okoro is only available for 4"). A solver that says "no solution" without saying why is useless to a vice-principal. **This diagnostic is what makes the feature usable, and most implementations skip it.**

Run it as a background job with progress reporting — it's not a request/response operation.

**The artifact:** a real school's constraints, solved, with the run time and the soft-constraint cost printed. Put the before/after (hand-made timetable vs generated) in the README.

---

## The CBT exam engine

Computer-based testing has to be correct under adversarial conditions — the students *will* try to break it.

- **Question bank** with tags, difficulty, and per-exam randomisation (shuffle questions and options per student, from a seed stored on the attempt so it's reproducible for review)
- **Timer authority is the server, never the browser.** The client displays a countdown; the server decides when time is up. A student who changes their system clock or edits the DOM gains nothing.
- **Autosave every answer immediately.** Power cuts happen mid-exam. An attempt must survive a browser crash and resume exactly where it was.
- **Attempt state machine:** `not_started → in_progress → submitted → graded`. Submission is idempotent — double-clicking "submit" must not create two attempts.
- **Objective questions auto-grade; essays queue for a teacher.** Store the marking scheme with the question, versioned, so a question edited next term doesn't retroactively change last term's scores.
- Live invigilation view (`packages/realtime`): who is in progress, who has submitted, who disconnected.

---

## Fees — this is a ledger, not a number in a column

Every school system that stores `outstanding_balance` as a column eventually has a parent standing at the bursar's desk with a receipt the system doesn't know about.

- `fee_structures` — per class, per term: tuition, levies, optional items
- Invoicing generates a charge → **posts to `packages/ledger`** (Dr `1200` Student Receivable, Cr `4000` Tuition Revenue)
- Payments credit the receivable. Balance is **derived**.
- Part-payments, waivers/scholarships (a credit note, not an edit), and sibling discounts
- **Reconciliation against bank statements** — import CSV, match by reference, flag unmatched. This is the unglamorous feature every bursar actually needs and nobody builds.
- Arrears report by class, with ageing

---

## Data model

```
School (org) ──< AcademicSession ──< Term
                      │
    ┌─────────────────┼──────────────────┬────────────────┐
 Student ──< Enrollment >── Class ──< Timetable        FeeStructure
    │                         │           └──> (teacher, subject, room, slot)
    ├──< Attendance           └──< Subject ──< Teacher
    ├──< Assessment ──< Score
    ├──< Invoice ──> JournalEntry
    └──< Guardian
```

- **Everything is scoped to a `term`.** Nigerian schools run three terms; results, fees, attendance, and timetables all reset per term. Getting the term boundary wrong is the most common structural mistake — bake it into the schema from day one, not as an afterthought.
- `assessments` — CA1, CA2, exam; each with a weight. Final score is the weighted sum.
- Grading scale is **configurable per school** and effective-dated per session. Do not hardcode A/B/C boundaries — schools differ, and they change them.

---

## Screens

```
/[school]/students                    roster, enrollment, guardians
/[school]/timetable                   the grid; "Generate" runs the solver
/[school]/timetable/conflicts         why it couldn't solve, in plain English
/[school]/exams                       question bank, exam setup, scheduling
/[school]/exams/[id]/invigilate       live attempt monitoring (realtime)
/[school]/results                     score entry, computed grades, report cards (PDF)
/[school]/fees                        structures, invoice run, payments, reconciliation
/[school]/fees/arrears                ageing by class
/[school]/attendance                  daily register
/portal/parent                        my child: results, fees, attendance, timetable
/portal/student                       my timetable, my results, take exam
```

**The report card is the deliverable parents judge you on.** It must be a clean, printable PDF with the school's crest, term scores, position in class, and a teacher's comment. Schools will accept a lot of rough edges elsewhere and none here.

---

## Build state

**Phase 1 — Foundations**
- [ ] Built on `packages/core`; sessions and terms in the schema from the start
- [ ] Students, guardians, classes, subjects, teachers, enrollment
- [ ] Attendance register

**Phase 2 — Timetabling** (the flagship — budget real time for it)
- [ ] Constraint model: variables, domains, hard constraints
- [ ] Solver v1: propagation + backtracking with MCV/LCV heuristics
- [ ] Solver v2: local search fallback with a weighted cost function
- [ ] **Infeasibility diagnostics** — name the unsatisfiable constraint in plain English
- [ ] Background job with progress; manual drag-to-override with live conflict warnings
- [ ] Benchmark on a realistic school (30 classes, 40 teachers) — record the runtime

**Phase 3 — Assessment**
- [ ] Question bank, exam setup, per-student randomisation with stored seed
- [ ] CBT delivery: server-authoritative timer, autosave, resume-after-crash
- [ ] Idempotent submission
- [ ] Auto-grading + essay queue
- [ ] Live invigilation (realtime)
- [ ] Score entry, weighted computation, configurable grading scale
- [ ] Report card PDF

**Phase 4 — Fees**
- [ ] Fee structures per class per term
- [ ] Invoice run → `packages/ledger`
- [ ] Payments, part-payments, waivers (credit notes)
- [ ] Bank statement import + reconciliation
- [ ] Arrears ageing

**Phase 5 — Portals & proof**
- [ ] Parent portal, student portal
- [ ] Performance analytics (`packages/analytics`)
- [ ] Seed a demo school: 30 classes, 600 students, a generated timetable, a term of results
- [ ] README leading with the timetabler — constraints, approach, benchmark
- [ ] Deploy with demo logins for admin / teacher / parent / student

## What Patrick needs to provide

- A **real school's constraint set** to test the solver against — this is the single most valuable input. IFS Nigeria may open the door to one; a school with a hand-made timetable and a frustrated vice-principal is the ideal collaborator, and a plausible first customer.
- The grading scale and assessment weights the target schools use
- Whether CBT is v1 scope (it's substantial on its own)
- A name decision (Termly is a placeholder)
