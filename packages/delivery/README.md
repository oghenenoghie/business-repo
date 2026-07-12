# `packages/delivery`

Webhook delivery — HMAC-signed payloads, exponential-backoff retries with jitter, endpoint
circuit-breaking, and a dead-letter queue. **Planned** — cut from the six-day scope (see
[`docs/SIX-DAY-PLAN.md`](../../docs/SIX-DAY-PLAN.md)), not scheduled yet.

**Status:** not started. This package is migrating in from a prior standalone project
(`relay`). Its original README is kept at [`LEGACY_README.md`](./LEGACY_README.md) — the
architecture decisions there (at-least-once delivery stated explicitly, full jitter on
backoff, never retrying 4xx) still hold; the migrations and code have not been lifted over
yet.

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/relay-webhooks/SKILL.md
```
