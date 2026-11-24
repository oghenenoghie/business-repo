# Ajo — `apps/coop`

Cooperative society: member savings, loans, and dividends. **Cut from the six-day scope**
(see [`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)) — specced, not scheduled yet.

**Status:** Phase 1 (members & savings) has a working UI on top of the full database layer.
`migrations/0001_coop.sql` has the full schema — members, contributions, share capital, loans,
repayment schedules, guarantors, dividend runs and allocations — with RLS mirroring
`packages/core`'s pattern; `migrations/0002_society_settings.sql` adds a per-society loan
eligibility multiplier. On top of that: `src/members.ts`, `src/contributions.ts`, and
`src/statement.ts` (a member's savings balance and transaction history, derived entirely from
the ledger, never a stored column — proven in `tests/contributions.spec.ts` against the
ledger's own independent account balance), plus a demo Next.js UI — login, dashboard, member
roster with per-member ledger-derived balances, a member statement page, and a contributions
posting run.

Phase 2 (loans) is built end to end, engine and UI: `src/loans.ts` — application, an
eligibility engine (`savings × a configurable per-society multiplier − outstanding −
guaranteed`), guarantors (a guarantee is itself subject to the guarantor's own eligibility
check), flat-rate amortization (schedule generated at disbursement, immutable; the final
installment absorbs any rounding residual so `sum(principalDue) === principal` exactly),
disbursement and repayment ledger postings, and an arrears ageing report (30/60/90+ buckets) —
proven end to end in `tests/loans.spec.ts` (full apply → guarantee → approve → disburse →
repay lifecycle, the ledger's trial balance re-checked at every step). On top of that: a
`/loans` pipeline view with an arrears summary, `/loans/new` with a live eligibility preview
(`/api/eligibility`, debounced as the treasurer types), and `/loans/[id]` with the repayment
schedule, guarantors, and the approve/disburse/record-repayment actions gated by role and loan
status — verified with a clean `next build`. `reducing_balance` amortization is accepted by
the schema but not yet implemented at the application layer.

Not yet built: dividends (Phase 3), the member self-service portal, loan write-off/rescheduling,
bank-statement import. Depends on `packages/core` and `packages/ledger`.

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
