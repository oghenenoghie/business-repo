# `packages/core`

Tenancy, RBAC, Postgres row-level security, and audit logging — the foundation every app in
this monorepo is built on.

**Status:** not started. This package is migrating in from a prior standalone project
(`helio`). Its original README is kept at [`LEGACY_README.md`](./LEGACY_README.md) — the
architecture decisions there (RLS over app-layer filtering, Stripe webhooks as source of
truth for billing state, composite PKs on memberships) still hold; the migrations and code
have not been lifted over yet.

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/helio-saas-platform/SKILL.md
```

Read it before writing code here; update its Build State checklist when a phase lands.
