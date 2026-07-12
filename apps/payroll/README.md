# Wagebook — `apps/payroll`

Multi-jurisdiction payroll. **Build this first** — it is the one app scoped to ship by
Friday (Nigeria only; Kuwait is specced and cut, see
[`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)).

**Status:** not started. Depends on `packages/core` (tenancy/RBAC/RLS) and `packages/ledger`
(posting payroll runs to the general ledger).

**Done when:** a payslip computes correctly against real NG tax tables (golden tests first,
UI second), and a full payroll run for 20 employees works end to end.

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/wagebook-payroll/SKILL.md
```

Read it before writing code here; update its Build State checklist when a phase lands.
