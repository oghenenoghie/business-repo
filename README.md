# Business Systems Platform

A multi-tenant platform with a shared core and four vertical products.

```
packages/
  core/      tenancy, RBAC, Postgres RLS, audit log
  ledger/    double-entry accounting — integer money, balanced-or-abort, append-only
  rules/     effective-dated statutory rules engine — pure (snapshot, rule_set) -> payslip
  realtime/  presence, optimistic sync            (planned)
  delivery/  webhook delivery, retries            (planned)
  analytics/ events, funnels, cohorts             (planned)

apps/
  payroll/   Wagebook — multi-jurisdiction payroll (Nigeria first, Kuwait specced)
  coop/      Ajo      — cooperative society: savings, loans, dividends
  hotel/     Portier  — property management: reservations, folios, night audit
  school/    Termly   — timetabling, CBT exams, fees
```

## Status

`packages/core`, `packages/ledger`, `packages/rules`, and the `apps/payroll` run engine are
built and tested. There is no UI, no HTTP layer, and no deployment yet — see
[`docs/SIX-DAY-PLAN.md`](docs/SIX-DAY-PLAN.md) for the build order, and each package/app
`README.md` for its individual status.

**The RLS test result:** Org A provably cannot read Org B's rows —
[`packages/core/tests/rls.spec.ts`](packages/core/tests/rls.spec.ts), 8 tests, all green.

**The ledger result:** under 100 rounds of randomized balanced postings, the trial balance
sums to exactly `0n` and every account balance matches an independent raw-SQL aggregate —
[`packages/ledger/tests/ledger.spec.ts`](packages/ledger/tests/ledger.spec.ts), 8 tests, all
green. A forged unbalanced entry that bypasses the application-layer check is still rejected
by Postgres's deferred constraint trigger.

**The payroll result:** a payslip computes correctly against the Nigeria Tax Act 2025 PAYE
bands (effective 2026-01-01) — three hand-verified golden cases with the arithmetic shown in
comments, plus a monotonicity property test —
[`packages/rules/tests/golden/ng2026.spec.ts`](packages/rules/tests/golden/ng2026.spec.ts),
18 tests across the package, all green. Sources are cited in
[`packages/rules/src/jurisdictions/ng2026.ts`](packages/rules/src/jurisdictions/ng2026.ts).

**The payroll-run result:** a full run for 20 employees — `draft → calculated → posted`,
mixed pension/NHF opt-in and rent relief, one balanced ledger entry posted per run, both
immutability guards enforced (a posted run can't be recalculated or re-approved), and a
payslip PDF rendered —
[`apps/payroll/tests/payrollRun.spec.ts`](apps/payroll/tests/payrollRun.spec.ts), 4 tests,
all green.

CI (`.github/workflows/ci.yml`) runs all four suites (Postgres-backed where needed) on every
push and PR.

```mermaid
graph TD
    core[packages/core<br/>tenancy · RBAC · RLS · audit]
    ledger[packages/ledger<br/>double-entry · integer money]
    rules[packages/rules<br/>statutory rules engine]
    payroll[apps/payroll<br/>Wagebook]
    coop[apps/coop<br/>Ajo]
    hotel[apps/hotel<br/>Portier]
    school[apps/school<br/>Termly]
    core --> payroll & coop & hotel & school
    ledger --> payroll & coop & hotel
    rules --> payroll
```

## Why a monorepo

`ledger` is used by payroll, coop, **and** hotel. In four separate repos that means four
copies of the money code — you fix a rounding bug in one and forget the other three. That
isn't hypothetical; it's the default outcome, and it's how financial bugs survive for years.

Shared code, separate products. The apps are independent at runtime and share nothing but
the packages. One Postgres server, one database per app. If the hotel crashes, payroll
keeps running.

## The rules that are not negotiable

**Money is a `bigint` in minor units.** `0.1 + 0.2 !== 0.3`. A float in a money column is
money silently disappearing, and an accountant will find it before you do.

**Not every currency has two decimals.** `1 KWD = 1000 fils`. Hardcode `× 100` and every
Kuwaiti figure is wrong by a factor of ten. The exponent is looked up per currency.

**Every journal entry balances, or it does not exist.** Checked in the application *and*
by a deferred constraint trigger in Postgres, so no future code path can bypass it.

**The ledger is append-only.** No `UPDATE`, no `DELETE` — enforced by database rules.
Corrections are reversing entries. The wrong number stays visible, linked to what replaced it.

**Allocation sums exactly.** Splitting a dividend across 500 members with naive `floor()`
loses a few kobo. `allocate()` uses the largest-remainder method so the parts sum to the
total exactly. A dividend run that loses ₦3 gets rejected at the AGM.

Full detail on each of these lives in [`.claude/skills/ledger-core/SKILL.md`](.claude/skills/ledger-core/SKILL.md).

## Running it

```bash
pnpm install
docker compose up -d postgres redis

pnpm --filter @bp/core exec tsx scripts/create-db.ts
pnpm --filter @bp/core run migrate
pnpm --filter @bp/core test          # cross-tenant RLS suite

pnpm --filter @bp/ledger exec tsx scripts/create-db.ts
pnpm --filter @bp/ledger run migrate # applies core's migrations first, then ledger's
pnpm --filter @bp/ledger test        # trial-balance property tests

pnpm --filter @bp/rules test         # no database needed — pure computation

pnpm --filter @bp/payroll exec tsx scripts/create-db.ts
pnpm --filter @bp/payroll run migrate # applies core's, ledger's, then payroll's migrations
pnpm --filter @bp/payroll test        # a full 20-employee run, draft -> calculated -> posted
```

`pnpm dev` has nothing to run yet — no UI or HTTP layer exists (see Status above).

## Project context for AI assistants

Full specs and phase-by-phase Build State checklists live in [`.claude/skills/`](.claude/skills):

```
ledger-core/               packages/ledger    — read first, three apps post money through it
helio-saas-platform/       packages/core
cadence-realtime-board/    packages/realtime  (planned)
relay-webhooks/            packages/delivery  (planned)
pulse-analytics/           packages/analytics (planned)
wagebook-payroll/          apps/payroll and packages/rules — build this first
ajo-cooperative/           apps/coop
portier-hotel/             apps/hotel
termly-school/             apps/school
corpus-ai-rag/             a separate, standalone repo — not part of this monorepo
```

Load the relevant skill, read its Build State checklist, resume. Update it when a phase
finishes.

## Planning docs

- [`docs/SIX-DAY-PLAN.md`](docs/SIX-DAY-PLAN.md) — the build order and what's cut
- [`docs/GITHUB-SETUP.md`](docs/GITHUB-SETUP.md) — what gets pushed where, and how repos are described/pinned
