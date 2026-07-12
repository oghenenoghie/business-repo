---
name: wagebook-payroll
description: Full project context for Wagebook — a multi-jurisdiction HR and payroll platform (Next.js 15 + Postgres) with an effective-dated statutory rules engine supporting Nigeria (PAYE, pension, NHF, NSITF) and Kuwait/GCC (PIFSS, end-of-service indemnity, WPS export), built on a shared multi-tenant core and a double-entry ledger. Use this skill whenever working on Wagebook in any way — the rules engine, jurisdiction packs, payroll runs, payslip generation, statutory deductions, end-of-service accrual, WPS file export, employee records, leave, or the ledger postings. Trigger this even when the user doesn't say "Wagebook" explicitly — any mention of the payroll project, PAYE or pension or NHF or NSITF, PIFSS or gratuity or indemnity or WPS, the effective-dated rules engine, or PayrollRun/Payslip/RuleSet/Component entities qualifies. Read this before generating any Wagebook code, and update the Build State checklist at the end of every session.
---

# Wagebook — Multi-Jurisdiction HR & Payroll

> Name is a placeholder — check availability before the repo goes public.

**Portfolio thesis:** payroll is the rare domain where "it works" is not the bar — it must be *provably* correct, *reproducible years later*, and *auditable*. Money in integers, rules as versioned data, payslips immutable once approved. Reviewers who have shipped financial software recognise this immediately; reviewers who haven't are told plainly why it matters.

**Commercial thesis:** supporting Nigeria and Kuwait in one engine means one codebase sells into both markets. Every company on earth runs payroll.

**One-liner:** *Payroll that recomputes March 2024 with March 2024's tax law — a multi-tenant HR platform with an effective-dated statutory rules engine, double-entry ledger postings, and jurisdiction packs for Nigeria and the GCC.*

---

## Stack

- **Frontend:** Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui
- **Backend:** Next.js Server Actions + Route Handlers; heavy payroll runs as a background job
- **DB:** Postgres (Supabase) — RLS on every tenant table, from `packages/core`
- **Shared packages:** `core` (tenancy/RBAC/billing/audit), `ledger` (double-entry), `rules` (effective-dated engine)
- **PDF:** payslips rendered server-side (React → PDF)
- **Deploy:** VPS (Docker + Coolify) or Vercel + Supabase

---

## Non-negotiable rules

These are not style preferences. Violating any one of them is a defect.

### 1. Money is an integer. Always.

Store **minor units** as `bigint`: kobo for NGN, fils for KWD (KWD has **three** decimal places, not two — `1 KWD = 1000 fils`. Assuming two will silently corrupt every Kuwaiti payslip).

```ts
type Money = { amount: bigint; currency: "NGN" | "KWD"; }  // amount is in minor units
```

Never `float`. Never `number` for money in JS. Never `0.1 + 0.2`. A float in a money column is an instant fail in any serious code review, and it is the single most common bug in amateur payroll software.

Rounding is **explicit and specified per jurisdiction** (half-up, half-even, truncate). Rounding differences of one kobo across 500 employees is a reconciliation nightmare — decide once, apply everywhere, test it.

### 2. Rules are data, not code.

Tax bands change by legislation. If your bands live in a TypeScript file, then when the law changes mid-year you must redeploy code to fix a client's payroll — on the 28th, at 11pm, while they scream at you.

Rules live in the database as versioned, effective-dated rows and are executed by a small interpreter. Adding a new tax year is an **INSERT**, not a deploy.

### 3. A payroll run is reproducible forever.

Recomputing the March 2024 run in 2027 must yield **byte-identical** figures. That means the run stores a reference to the exact `rule_set_version` it used, and the engine is a pure function of `(employee_snapshot, rule_set_version, period)`. No `Date.now()`. No "current" anything.

### 4. Approved payslips are immutable.

Once a run is approved, nothing edits it. Corrections are a **new adjustment run** that posts a delta. This is how real payroll works, it is what auditors require, and it is the difference between a toy and a system.

---

## The rules engine

```
jurisdictions          NG, KW, (GB, ...)
  └── rule_sets        one per jurisdiction per legislation period
        │              effective_from / effective_to, version, status
        └── components ordered, typed calculation steps
```

A **component** is one line on the payslip — an earning, a deduction, or an employer liability:

```jsonc
{
  "code": "PAYE",
  "type": "deduction",           // earning | deduction | employer_liability | accrual
  "sequence": 40,                // components run in order; later ones can read earlier results
  "applies_when": {              // conditional application — this is why the engine exists
    "nationality": "any",
    "employee_type": "any"
  },
  "calculation": {
    "method": "graduated_bands",
    "base": "TAXABLE_INCOME",    // refs a value produced by an earlier component
    "bands": [ /* effective-dated, seeded per tax year */ ]
  }
}
```

Calculation methods to support: `fixed`, `percentage_of`, `graduated_bands`, `capped_percentage`, `formula` (a tiny safe expression evaluator over prior component outputs), `accrual`.

### Why the conditional layer is load-bearing

Kuwait forces it. **PIFSS social security applies to Kuwaiti nationals and is not deducted from expatriates.** So component application depends on employee attributes, not just jurisdiction. Any engine that can't express "this deduction applies only when `nationality = KW`" cannot do GCC payroll at all.

Nigeria then forces the *other* half: graduated bands with reliefs, plus employer-side liabilities (NSITF, ITF) that never appear as employee deductions but must still be computed, posted to the ledger, and reported.

Between them, the two jurisdictions exercise every branch of the engine. That's not an accident — it's why this pair was chosen.

### Jurisdiction packs

```
rules/jurisdictions/
  ng/2024.json   ng/2025.json   ng/2026.json
  kw/2024.json   kw/2026.json
```

> ⚠️ **Verify every rate against current primary legislation before seeding.** Nigerian tax law was overhauled recently and published figures in blog posts and old tutorials are stale. Rates go in seed data precisely so that correcting them is an INSERT — but seed them *right*. Cite the source (gazette, statute, or the revenue authority's own tables) in a comment on every band.

### Nigeria (NG) — components to model
`BASIC`, `HOUSING`, `TRANSPORT`, gross build-up → statutory reliefs → `TAXABLE_INCOME` → **PAYE** (graduated bands) · **Pension** (employee + employer) · **NHF** · **NSITF** (employer) · **ITF** (employer)

### Kuwait (KW) — components to model
**No personal income tax** — the engine must handle a jurisdiction where the tax component set is empty, without special-casing.
**PIFSS** — nationals only, employee + employer portions, subject to a salary ceiling.
**End-of-service indemnity** — the interesting one: a liability that **accrues monthly** based on length of service and final salary, and is only *paid* on termination. It must appear on the balance sheet as it accrues, not appear from nowhere on the employee's last day. Model it as an `accrual` component posting to a liability account each run.
**WPS export** — payroll must emit a bank/ministry-mandated fixed-format file. Confirm the current spec; treat it as a pluggable exporter per jurisdiction.

---

## Data model

```
Organization (core) ──< Employee ──< EmploymentRecord (salary history, effective-dated)
                          │
PayrollRun ──< Payslip ──< PayslipLine ──> Component
    │
    └──> JournalEntry (ledger) ──< JournalLine
```

- `employees` — org_id, staff_number, name, nationality, employee_type, hire_date, termination_date, bank details, tax id, pension pin
- `employment_records` — **effective-dated** salary and grade. A raise is a new row, never an UPDATE. Payroll for March reads the record effective in March.
- `payroll_runs` — org_id, period (year, month), jurisdiction, `rule_set_version_id`, status (`draft`|`calculated`|`approved`|`posted`|`paid`), approved_by, approved_at
- `payslips` — run_id, employee_id, gross, total_deductions, net, `employee_snapshot` (jsonb — frozen copy of everything the calculation depended on)
- `payslip_lines` — payslip_id, component_code, type, amount (bigint minor units), sequence
- `accruals` — employee_id, kind (`end_of_service`|`leave`), balance (bigint), as_of

The `employee_snapshot` on each payslip is what makes reproducibility real: even if the employee later changes nationality, moves department, or is deleted, the March payslip still recomputes identically.

---

## Ledger postings

Every approved run posts a balanced journal entry via `packages/ledger`:

```
Dr  Salary Expense            gross + employer liabilities
  Cr  PAYE Payable                        (statutory, NG)
  Cr  Pension Payable                     (employee + employer)
  Cr  NHF Payable
  Cr  End-of-Service Provision            (accrual, KW)
  Cr  Net Pay Payable                     (what actually leaves the bank)
```

Debits must equal credits or the transaction aborts. The ledger is append-only: a mistake is corrected by a reversing entry, never by an UPDATE or DELETE. `packages/ledger` is shared with the cooperative app.

---

## The artifact that sells this repo

`tests/golden/` — a regression suite of hand-verified cases:

> Employee: Nigerian national, monthly gross ₦X, pension opted in, period 2025-03.
> Expected net: ₦Y. Expected PAYE: ₦Z. Expected employer cost: ₦W.

Each expectation is computed by hand from the published tax tables and cited in a comment. The suite runs in CI. **A payroll engine with a golden-set regression suite is the single most credible thing in this entire portfolio** — it says you understand that correctness in financial software is proven, not asserted.

Add a property test too: for any employee and any jurisdiction, `gross - sum(deductions) == net`, and every ledger entry balances to zero.

---

## Routes

```
/[org]/employees                    roster, filters, bulk import
/[org]/employees/[id]               profile, salary history, documents, accruals
/[org]/payroll                      run list
/[org]/payroll/new                  select period + jurisdiction → calculate → preview
/[org]/payroll/[runId]              variance vs last period, per-employee drill-down
/[org]/payroll/[runId]/approve      approval gate (immutability starts here)
/[org]/payroll/[runId]/exports      bank file / WPS file / statutory schedules
/[org]/payslips/[id]                employee-facing payslip (PDF)
/[org]/leave                        requests, balances, accrual
/[org]/settings/rules               jurisdiction packs, effective dates, versions
/[org]/reports                      statutory schedules, headcount cost, ledger export
```

**The variance screen matters more than it looks.** Before approving, the payroll officer must see *why* this run differs from last month — new joiners, leavers, raises, tax band changes. Every real payroll product has this, and it's what a domain expert looks for first when you demo.

---

## Conventions

- Money: `bigint` minor units, end to end. The only place a decimal appears is the render layer.
- Effective-dated tables are never UPDATEd; corrections insert a new row.
- Every payroll run and every approval writes to `audit_events`.
- Rounding rules are declared per jurisdiction in the rule set, never inferred.
- Commit directly to `main` unless told otherwise.

---

## Build state

**Phase 0 — Shared core** (this is the old "Helio" work; do it once, three apps use it)
- [x] Monorepo: `packages/core`, `packages/ledger`, `packages/rules`, `apps/payroll` (apps/payroll has a run engine and a Next.js UI now)
- [x] `core`: organizations, memberships, RBAC, RLS + `has_org_role()`, audit log
- [x] `core`: cross-tenant RLS test suite — 8 tests, `packages/core/tests/rls.spec.ts`
- [x] `ledger`: accounts, journal entries, journal lines; balanced-or-abort; append-only
- [x] `ledger`: trial balance must sum to zero — property test, `packages/ledger/tests/ledger.spec.ts`

**Phase 1 — Rules engine**
- [x] `rule_sets` (effective-dated, versioned), `components` — as in-memory TS data for now, not yet Postgres rows (see `packages/rules/README.md` "Not built yet")
- [x] Interpreter: `fixed`, `percentage_of`, `graduated_bands`, `capped_percentage`, `accrual` — `formula` (safe expression evaluator) not built; NG's components express without it
- [x] Conditional application (`applies_when` on nationality / employee_type / an arbitrary flag)
- [x] Pure calculation function: `(snapshot, rule_set, period) → Payslip` — `packages/rules/src/interpreter.ts`
- [x] Golden-set tests — `packages/rules/tests/golden/ng2026.spec.ts`, 5 tests, rates cross-verified against multiple independent sources (primary gazette could not be fetched directly in this environment — re-verify before using beyond this portfolio)

**Phase 2 — Jurisdiction packs**
- [x] NG pack: PAYE bands + rent relief, pension, NHF, NSITF, ITF — `packages/rules/src/jurisdictions/ng2026.ts`
- [ ] KW pack: no income tax, PIFSS (nationals only, with ceiling), end-of-service accrual — cut from this week's scope, see `docs/SIX-DAY-PLAN.md`
- [x] The interpreter itself has no jurisdiction-specific branching — proven in `packages/rules/tests/interpreter.spec.ts` against a synthetic rule set unrelated to either country. Not yet proven against a second *real* jurisdiction, since KW isn't built.

**Phase 3 — Payroll runs**
- [x] Employees + effective-dated employment records — `apps/payroll/src/employees.ts`, append-only, mirrors the ledger's discipline
- [x] Run lifecycle: draft → calculated → posted (skipped a distinct "approved" step separate from posting — approving a run posts it in the same transaction; "paid" is not modeled, that's a bank-file/reconciliation concern for Phase 4)
- [x] Immutability: `calculateRun()` only runs from `draft`, `approveAndPostRun()` only from `calculated` — proven in `apps/payroll/tests/payrollRun.spec.ts` (recalculating or re-approving a posted run throws)
- [ ] Adjustment runs for corrections — the guard against mutating a posted run exists; the adjustment-run flow to actually correct one doesn't yet
- [x] `employee_snapshot` freezing — `payslips.employee_snapshot`, set at calculation time
- [x] Ledger postings — one balanced entry per run (aggregated across all employees' payslip lines), idempotent on `payroll:${runId}`
- [ ] Variance screen (this run vs last) — no UI exists yet

**Phase 4 — Outputs**
- [x] Payslip PDF — `apps/payroll/src/payslipPdf.ts`, plain and unbranded (pdfkit)
- [ ] Bank payment file (NG) + WPS file (KW) — pluggable exporters
- [ ] Statutory schedules (PAYE remittance, pension schedule)
- [ ] Employee self-service portal

**Phase 5 — HR surface**
- [ ] Leave requests + accrual
- [ ] Documents, contracts
- [ ] Headcount cost reporting

**Phase 6 — Proof**
- [x] Golden-set suite green in CI, with sources cited
- [x] Property tests: gross − deductions = net (`interpreter.spec.ts`); every journal entry balances (`ledger.spec.ts`, `payrollRun.spec.ts`)
- [x] Seed a demo org — `apps/payroll/scripts/seed-demo.ts`: 22 employees, NG only (no KW jurisdiction pack to seed against yet), a full posted 2026-03 run
- [x] README leading with reproducibility + integer money + rules-as-data
- [ ] Deploy with a demo login — UI, demo-login flow, and seed script are built and verified end-to-end locally (Playwright: login → dashboard → employees → payroll → PDF); a live URL was attempted against a Supabase-hosted Postgres (isolated in its own `wagebook` schema) and Vercel, but blocked by a 403 "You don't have permission to create a Production/Preview Deployment" on the connected Vercel account/team — see `apps/payroll/README.md#deploying`. No demo URL exists yet.

## What Patrick needs to provide

- **Current statutory rates, from primary sources** — NG revenue authority tables and the current tax act; Kuwait PIFSS rates, ceiling, and indemnity formula; the current WPS file spec. Do not seed from a blog post.
- A decision on the product name (Wagebook is a placeholder)
- Supabase/Postgres instance
- Optional but valuable: **one real payroll officer to look at the variance screen for ten minutes.** Domain feedback here is worth more than any amount of polish.
