# Ajo — `apps/coop`

Cooperative society: member savings, loans, and dividends. **Cut from the six-day scope**
(see [`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)) — specced, not scheduled yet.

**Status:** Phase 1 (members & savings) has a working UI on top of the full database layer.
`migrations/0001_coop.sql` has the full schema — members, contributions, share capital, loans,
repayment schedules, guarantors, dividend runs and allocations — with RLS mirroring
`packages/core`'s pattern. On top of that: `src/members.ts`, `src/contributions.ts`, and
`src/statement.ts` (a member's savings balance and transaction history, derived entirely from
the ledger, never a stored column — proven in `tests/contributions.spec.ts` against the
ledger's own independent account balance), plus a demo Next.js UI — login, dashboard, member
roster with per-member ledger-derived balances, a member statement page, and a contributions
posting run. Not yet built: loans (eligibility engine, amortization, guarantors), dividends,
the member self-service portal. Depends on `packages/core` and `packages/ledger`.

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
