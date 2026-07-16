# Ajo — `apps/coop`

Cooperative society: member savings, loans, and dividends. **Cut from the six-day scope**
(see [`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)) — specced, not scheduled yet.

**Status:** Phases 1-3 are built end to end. `migrations/0001_coop.sql` has the full schema —
members, contributions, share capital, loans, repayment schedules, guarantors, dividend runs
and allocations — with RLS mirroring `packages/core`'s pattern; `migrations/0002_society_settings.sql`
adds a per-society loan eligibility multiplier; `migrations/0003_interest_accrual.sql` adds
interest accrual tracking. On top of that: `src/members.ts`, `src/contributions.ts`, and
`src/statement.ts` (a member's savings balance and transaction history, derived entirely from
the ledger, never a stored column — proven in `tests/contributions.spec.ts` against the
ledger's own independent account balance), plus a demo Next.js UI — login, dashboard, member
roster with per-member ledger-derived balances, a member statement page, and a contributions
posting run.

Phase 2 (loans): `src/loans.ts` — application, an eligibility engine (`savings × a configurable
per-society multiplier − outstanding − guaranteed`), guarantors (a guarantee is itself subject
to the guarantor's own eligibility check), both flat-rate and reducing-balance amortization
(schedule generated at disbursement, immutable; the final installment absorbs any rounding
residual so `sum(principalDue) === principal` exactly), disbursement and repayment ledger
postings, and an arrears ageing report (30/60/90+ buckets) — proven end to end in
`tests/loans.spec.ts` (full apply → guarantee → approve → disburse → repay lifecycle for both
amortization methods, the ledger's trial balance re-checked at every step). On top of that: a
loans UI — `/loans` (pipeline + arrears banner), `/loans/new` (application form with a live
eligibility check as the amount is typed), `/loans/[id]` (schedule, guarantors,
approve/disburse/repay actions) — plus demo loans seeded in three pipeline states (pending,
active with an overdue installment, fully repaid).

Phase 3 (year end): `src/interestAccrual.ts` — an accrual run that recognizes interest income
early (Dr Interest Receivable / Cr Interest Income) for due-but-unpaid installments, marking
each so a later repayment credits the receivable instead of double-booking income;
`src/dividends.ts` — a `create → allocate → approve → post` dividend run, pro-rata on savings,
using the largest-remainder method so `sum(allocated) === distributableSurplus` exactly, never
approximately (only the `savings` basis is implemented — `share_capital`/`patronage` aren't,
since no application code writes `share_capital` yet). Both proven end to end in
`tests/interestAccrual.spec.ts` and `tests/dividends.spec.ts`. A `/reports` screen surfaces
trial balance, key account balances, bucketed loan-book ageing, and both runs' history.

Not yet built: the member self-service portal, loan write-off/rescheduling, individual dividend
payouts, bank-statement import. Depends on `packages/core` and `packages/ledger`.

```bash
pnpm install
docker compose up -d postgres

pnpm --filter @bp/coop exec tsx scripts/create-db.ts
pnpm --filter @bp/coop run migrate    # applies core's, ledger's, then coop's migrations
pnpm --filter @bp/coop test           # RLS suite + contribution/statement/ledger-consistency tests

# demo UI
pnpm --filter @bp/coop exec tsx scripts/create-db.ts   # against a separate bp_coop_demo db
pnpm --filter @bp/coop run migrate
pnpm --filter @bp/coop run seed:demo  # 15 members with realistic contribution histories
pnpm --filter @bp/coop run dev        # http://localhost:3000 — demo login picks a persona
```

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/ajo-cooperative/SKILL.md
```
