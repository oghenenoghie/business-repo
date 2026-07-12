# `packages/analytics`

Event ingestion, funnel conversion analysis, and retention cohorts on plain Postgres.
**Planned** — cut from the six-day scope (see
[`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)), not scheduled yet.

**Status:** not started. This package is migrating in from a prior standalone project
(`pulse`). Its original README is kept at [`LEGACY_README.md`](./LEGACY_README.md) — the
architecture decisions there (time-partitioned events table, window-function funnels instead
of self-joins, Redis-cached aggregates with visible staleness) still hold; the migrations and
code have not been lifted over yet.

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/pulse-analytics/SKILL.md
```
