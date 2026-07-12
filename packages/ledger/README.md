# `packages/ledger`

The shared double-entry accounting engine used by payroll, the cooperative, and the hotel
app. Integer minor-unit money, balanced-or-abort, append-only with reversals instead of
edits.

**Status:** not started. See the [Six Day Plan](../../docs/SIX-DAY-PLAN.md) — this package
is the Tuesday deliverable, and `pnpm --filter @bp/ledger test` going green is the Sunday
gate for everything after it.

## Project context for AI assistants

Full spec — the four invariants, schema, API, and Build State checklist:

```
.claude/skills/ledger-core/SKILL.md
```

Read it before writing any code that touches a monetary amount; update its Build State
checklist when a phase lands.
