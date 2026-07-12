# `packages/rules`

An effective-dated statutory rules engine. A payroll run is a pure function of
`(employee_snapshot, rule_set, period)` — no `Date.now()`, no I/O, no jurisdiction-specific
branching in the interpreter. What varies between jurisdictions (Nigeria, eventually Kuwait)
is data — a `RuleSet` — not code.

**Status:** interpreter built and tested; NG 2026 jurisdiction pack built and tested against
hand-verified golden cases. Kuwait is not built (cut from the six-day scope, see
[`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)).

## The interpreter

A `RuleSet` is an ordered list of `Component`s. Each component is typed (`earning` /
`deduction` / `employer_liability` / `accrual` / `relief` / `input`), has a calculation
method (`from_snapshot`, `sum_of`, `fixed`, `percentage_of`, `capped_percentage`, or
`graduated_bands`), and can be gated by `appliesWhen` (nationality, employee type, or an
arbitrary flag). Components run in sequence order and can reference any earlier component's
result as a `base`.

`appliesWhen.flag` is the same mechanism that will eventually express Kuwait's PIFSS
(nationals-only social security) and Nigeria's opt-in NHF — there's nothing jurisdiction-
specific in `src/interpreter.ts` itself; see `tests/interpreter.spec.ts`, which proves the
engine's mechanics with a synthetic rule set that has nothing to do with either country.

Money in, money out is `bigint` minor units throughout. Percentage rates are exact fractions
(`{ numerator, denominator }`), never floats — even the *rate configuration* avoids float
arithmetic, not just the storage. All division goes through `roundDivide()` with an
explicit, declared rounding mode.

## The NG 2026 pack

`src/jurisdictions/ng2026.ts` — PAYE (graduated bands + rent relief), pension (employee +
employer), NHF (opt-in), NSITF and ITF (employer liabilities). Every rate is cited at the top
of the file. The underlying legislation (Nigeria Tax Act 2025) could not be fetched directly
in this environment, so rates were cross-checked against multiple independent professional
sources rather than a single blog post — **re-verify against the primary gazette/Fourth
Schedule before this is used for anything beyond this portfolio.**

## The proof

`tests/golden/ng2026.spec.ts` — three hand-computed cases (mid earner, low earner entirely
in the 0% band, high earner with NHF and a capped rent relief), each with the full band-by-
band arithmetic shown in a comment so a reviewer can check it without running anything. Plus
a property test (gross − deductions = net) and a monotonicity test (PAYE never decreases as
taxable income increases). All green.

`tests/interpreter.spec.ts` — engine mechanics against a synthetic rule set: conditional
application, base resolution, component types, and an unknown-base error.

`tests/rounding.spec.ts` — `truncate` / `half_up` / `half_even`, including negative numbers.

## Not built yet

- Kuwait jurisdiction pack (PIFSS, end-of-service accrual) — cut from this week's scope
- The `formula` calculation method (a small safe expression evaluator) — every NG component
  expresses without it
- Rule sets are in-memory TypeScript data, not yet stored in Postgres as versioned rows —
  storing them is a natural next step once `apps/payroll` needs to pin a payroll run to a
  specific `rule_set_version_id` (see the skill's Phase 1 checklist)
- ITF is accrued monthly here as 1% of gross per run; the real levy is an annual remittance
  on the prior year's total payroll for employers meeting a size threshold — this is a
  simplification pending the actual payroll-run/ledger wiring

## Running it

```bash
pnpm --filter @bp/rules test
```

No database required — this package is pure computation.

## Project context for AI assistants

```
.claude/skills/wagebook-payroll/SKILL.md
```
