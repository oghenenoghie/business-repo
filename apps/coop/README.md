# Ajo — `apps/coop`

Cooperative society: member savings, loans, and dividends. **Cut from the six-day scope**
(see [`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)) — specced, not scheduled yet.

**Status:** database layer only. `migrations/0001_coop.sql` has the full schema — members,
contributions, share capital, loans, repayment schedules, guarantors, dividend runs and
allocations — with RLS mirroring `packages/core`'s pattern, plus a cross-tenant RLS test.
No application code (eligibility engine, amortization, dividend allocation, UI) yet. Depends
on `packages/core` and `packages/ledger`.

```bash
pnpm install
docker compose up -d postgres

pnpm --filter @bp/coop exec tsx scripts/create-db.ts
pnpm --filter @bp/coop run migrate   # applies core's, ledger's, then coop's migrations
pnpm --filter @bp/coop test          # cross-tenant RLS suite for members/loans/schedules
```

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/ajo-cooperative/SKILL.md
```
