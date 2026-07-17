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
via Playwright). **Deployed** on Vercel, Git-connected to this repo — see "Deploying" below
for the live URL. As a monorepo app, its build is scoped to this directory, so only commits
that touch `apps/payroll` produce a new deployment; a `main` push that only changes another
app (`apps/coop`, `apps/hotel`, `apps/school`) or shared packages correctly produces none.

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

**Live demo:** https://business-repo-payroll-j8le.vercel.app — pick a persona on the login
screen (owner, admin, or viewer) to see the seeded demo org as they would.

The app targets a shared Postgres instance via `TARGET_SCHEMA` (read by all three
`migrate.ts` scripts — `packages/core`, `packages/ledger`, `apps/payroll`): set it to an
app-specific schema name (e.g. `wagebook`) when deploying into a database that already hosts
unrelated apps' tables in `public`, so nothing here ever touches another app's schema or
grants. `APP_DATABASE_URL` at runtime then needs `?sslmode=require` for a hosted Postgres
provider reachable only over TLS, since `packages/core`'s `pg.Pool` doesn't set `ssl` on its
own.

Deployed on Vercel, backed by **Vercel Postgres (Neon)**:

1. Vercel dashboard → project → Storage → Create Database → Postgres, then connect it to the
   project. This injects `DATABASE_URL`/`DATABASE_URL_UNPOOLED` (used only for running
   migrations, below — `packages/core/src/db.ts` reads these as a fallback).
2. Run migrations against that database, in dependency order, with a strong
   `CORE_APP_USER_PASSWORD` (the default in `migrate.ts` is a placeholder Neon's control
   plane rejects as too weak):
   ```
   DATABASE_URL=<neon owner connection string> CORE_APP_USER_PASSWORD=<strong password> pnpm --filter @bp/core migrate
   DATABASE_URL=<neon owner connection string> CORE_APP_USER_PASSWORD=<strong password> pnpm --filter @bp/ledger migrate
   DATABASE_URL=<neon owner connection string> CORE_APP_USER_PASSWORD=<strong password> pnpm --filter payroll migrate
   ```
3. Seed the demo org: `DATABASE_URL=<neon owner connection string> pnpm --filter @bp/payroll seed:demo`
4. Set `APP_DATABASE_URL` in Vercel (Production **and** Preview) to a connection string using
   the `app_user` role (not the Neon owner role) with the password from step 2, so the
   deployed app actually runs under RLS instead of bypassing it as the table owner:
   ```
   postgresql://app_user:<password, percent-encoded if it contains reserved URL characters like #>@<neon-pooler-host>/<db>?sslmode=require
   ```
5. Redeploy.

Two gotchas that cost real debugging time getting here:
- A password containing `#` breaks `new URL()` in `db.ts` (`#` is the URL fragment
  delimiter) — percent-encode it as `%23` in the connection string, or avoid that character
  when generating the `app_user` password.
- `packages/core`'s own `migrate.ts` and every downstream package/app's `migrate.ts` must
  agree on how they key applied migrations in `schema_migrations` (`core/<file>`, not a bare
  filename) — see the comment in `packages/core/scripts/migrate.ts` — otherwise running
  core's migrate standalone and then a downstream one re-applies core's migration and
  collides with objects that already exist.

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/wagebook-payroll/SKILL.md
```

Read it before writing code here; update its Build State checklist when a phase lands.
