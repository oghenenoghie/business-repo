# Wagebook — `apps/payroll`

Multi-jurisdiction payroll. **Build this first** — it is the one app scoped to ship by
Friday (Nigeria only; Kuwait is specced and cut, see
[`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)).

**Status:** the payroll run engine is built and tested — employees, effective-dated
employment records, a run lifecycle (`draft` → `calculated` → `posted`) that wires
`packages/rules`' NG 2026 calculation into a single balanced `packages/ledger` posting per
run, and a minimal payslip PDF. **No UI, no HTTP layer, no auth flow** — this is the engine
behind the app, run and tested directly, in the same spirit as `packages/core`/`ledger`/
`rules` so far.

**The proof:** `tests/payrollRun.spec.ts` — a payroll run for 20 employees (spanning the 0%
PAYE band through the higher bands, mixed pension/NHF opt-in, some claiming rent relief), all
green:
- `draft → calculated → posted`, 20 payslips persisted
- the run's ledger posting balances (`trialBalance()` sums to `0n` for the org afterward),
  and the posted Net Pay Payable total matches the sum of every payslip's `net`
- **immutability**: recalculating a posted run throws (`must be "draft"`), re-approving
  throws (`must be "calculated"`)
- **idempotent posting**: approving is safe to call once per run — the ledger entry keys off
  `payroll:${runId}`
- a payslip PDF renders (`%PDF` header, non-trivial size)

## How a run works

1. `createEmployee()` + `addEmploymentRecord()` — the employment record is effective-dated
   and append-only, same discipline as the ledger: a raise is a new row, never an `UPDATE`.
2. `createPayrollRun(orgId, period, jurisdiction)` — idempotent per `(org, period,
   jurisdiction)`.
3. `calculateRun()` — for every employee active in the period, resolves their employment
   record as of the period start, builds an `EmployeeSnapshot`, and calls `packages/rules`'
   `calculatePayslip()`. Freezes the snapshot as `payslips.employee_snapshot` so recomputing
   this payslip years later reproduces the same figures even if the employee record has since
   changed. Only valid from `draft`.
4. `approveAndPostRun()` — aggregates every payslip's lines into one balanced journal entry
   (`Dr Salary Expense = gross + employer liabilities`, credited across PAYE/Pension/NHF/
   NSITF/ITF/Net Pay Payable) and posts it via `packages/ledger`. Only valid from
   `calculated`; this is where immutability actually starts.
5. `renderPayslipPdf()` — a plain, unbranded payslip: earnings, deductions, employer cost,
   gross, net.

## Not built yet

- Any UI, route, or HTTP layer — everything above is called directly from tests
- Adjustment runs for corrections (the plan calls for these instead of ever mutating an
  approved run; the immutability guard exists, the adjustment-run flow doesn't yet)
- Bank payment file / WPS export, statutory schedules, employee self-service, leave — all
  Phase 4/5 in the skill, out of this week's scope
- A chart of accounts must be seeded per org (`seedChartOfAccounts(client, orgId, "payroll",
  currency)` from `packages/ledger`) before a run can post — this is an org-setup step, not
  something a run does automatically

## Running it

```bash
docker compose up -d postgres     # from the repo root
pnpm --filter @bp/payroll exec tsx scripts/create-db.ts   # DATABASE_URL defaults to bp_payroll
pnpm --filter @bp/payroll run migrate   # applies core's, ledger's, then this app's migrations
pnpm --filter @bp/payroll test
```

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/wagebook-payroll/SKILL.md
```

Read it before writing code here; update its Build State checklist when a phase lands.
