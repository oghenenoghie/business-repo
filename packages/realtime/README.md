# `packages/realtime`

Presence, live cursors, and optimistic sync with conflict-free ordering. **Planned** — cut
from the six-day scope (see [`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)), not
scheduled yet.

**Status:** not started. This package is migrating in from a prior standalone project
(`cadence`). Its original README is kept at [`LEGACY_README.md`](./LEGACY_README.md) — the
architecture decisions there (fractional indexing, three separate realtime channels,
optimistic writes reconciled against a pending queue) still hold; the migrations and code
have not been lifted over yet.

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/cadence-realtime-board/SKILL.md
```
