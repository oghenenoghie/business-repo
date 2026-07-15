# Wagebook — `apps/payroll`

Multi-jurisdiction payroll. **Build this first** — it is the one app scoped to ship by
Friday (Nigeria only; Kuwait is specced and cut, see
[`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)).

**Status:** the payroll run engine is built and tested — employees, effective-dated
employment records, a run lifecycle (`draft` → `calculated` → `posted`) that wires
`packages/rules`' NG 2026 calculation into a single balanced `packages/ledger` posting per
run, and a minimal payslip PDF. A Next.js UI now sits on top (demo login, dashboard,
employees, payroll runs, payslip PDF download) and a seed script builds a full demo org —
verified end-to-end locally (login → dashboard → employees → payroll → PDF, screenshotted
via Playwright). **Not yet deployed**: a live demo URL was attempted against Vercel but
blocked by a permission error on the connected account/team ("You don't have permission to
create a Production/Preview Deployment for this project") — see "Deploying" below.

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

- Real authentication — the deployed UI uses a fixed set of demo personas (owner/admin/
  viewer) selected from a login page and stored in a plain httpOnly cookie, not Supabase Auth
  or any other real identity provider. This is a deliberate simplification to stay consistent
  with the `app.current_user_id` RLS mechanism `packages/core` already has — see
  `src/lib/session.ts`.
- A live deployment. See "Deploying" below.
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

To run the UI against a seeded demo org:

```bash
pnpm --filter @bp/payroll run seed:demo   # builds "Wagebook Demo": 22 employees, a posted March 2026 run
pnpm --filter @bp/payroll dev
```

## Deploying

The app targets a shared Postgres instance via `TARGET_SCHEMA` (read by all three
`migrate.ts` scripts — `packages/core`, `packages/ledger`, `apps/payroll`): set it to an
app-specific schema name (e.g. `wagebook`) when deploying into a database that already hosts
unrelated apps' tables in `public`, so nothing here ever touches another app's schema or
grants. `APP_DATABASE_URL` at runtime then needs `?sslmode=require` for a hosted Postgres
provider reachable only over TLS (e.g. Supabase's connection pooler), since `packages/core`'s
`pg.Pool` doesn't set `ssl` on its own.

A Vercel deployment (`vercel.json` with the `env.APP_DATABASE_URL` for the target database,
`rootDirectory: "apps/payroll"`) was attempted against a live Supabase project (isolated in
its own `wagebook` Postgres schema, with a dedicated `app_user` role scoped to only that
schema — confirmed via `information_schema.role_table_grants`) but blocked by a 403 from
Vercel: *"You don't have permission to create a Production/Preview Deployment for this
project."* This is an account/team role or billing restriction on the connected Vercel
account, not a code issue — resolving it (checking the team member role, or deploying under
a different account/team) is the next step before a live demo URL exists.

Once deployed, don't point `APP_DATABASE_URL` at Supabase's direct `db.<ref>.supabase.co`
host — it resolves IPv6-only, which Vercel's serverless runtime can't reach
(`getaddrinfo ENOTFOUND`). Use Supabase's **connection pooler** host instead (Supabase
dashboard → Project Settings → Database → Connection string → "Transaction" mode, port
6543 — IPv4). Easiest path: connect the official Vercel↔Supabase integration (from either
project's dashboard, under Integrations), which keeps `POSTGRES_URL` /
`POSTGRES_URL_NON_POOLING` synced automatically and re-syncs them if Supabase credentials
rotate — `packages/core/src/db.ts` falls back to `POSTGRES_URL` (pooled) when
`APP_DATABASE_URL` isn't set, so no extra aliasing is needed once that integration is
connected.

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/wagebook-payroll/SKILL.md
```

Read it before writing code here; update its Build State checklist when a phase lands.
