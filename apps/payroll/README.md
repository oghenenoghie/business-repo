# Wagebook — `apps/payroll`

Multi-jurisdiction payroll. **Build this first** — it is the one app scoped to ship by
Friday (Nigeria only; Kuwait is specced and cut, see
[`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)).

**Status:** not started — but its dependencies are ready. `packages/rules` now computes a
correct NG payslip as a pure function (golden tests green, see
[`packages/rules/README.md`](../../packages/rules/README.md)), `packages/core` has
tenancy/RBAC/RLS, and `packages/ledger` can post the result to a general ledger. What's left
here is the app itself: employees, employment records, a payroll run that wires
`packages/rules` output into `packages/ledger` postings, and payslip output.

**Done when:** a full payroll run for 20 employees works end to end, posts to the ledger, and
produces a payslip.

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/wagebook-payroll/SKILL.md
```

Read it before writing code here; update its Build State checklist when a phase lands.
