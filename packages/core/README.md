# `packages/core`

Tenancy, RBAC, Postgres row-level security, and audit logging — the foundation every app in
this monorepo is built on.

**Status:** tenancy/RLS/audit foundation is built and tested. Identity for RLS comes from an
app-set session variable (`app.current_user_id`), not Supabase's `auth.uid()` — this package
targets a plain, self-hosted Postgres on the VPS. Billing, invites, and UI are out of scope
here (see the scope note in the skill file below); those belonged to the standalone `helio`
project this package is descended from, kept at [`LEGACY_README.md`](./LEGACY_README.md).

**The proof:** `tests/rls.spec.ts` authenticates as a member of Org A and asserts every read
and write against Org B's rows — including an unfiltered `select * from organizations` with
no `where` clause at all — returns zero rows or is rejected. 8 tests, all green.

## What's here

- `migrations/0001_core.sql` — `organizations`, `memberships`, `audit_events`; RLS policies;
  `current_user_id()` and `has_org_role()` helper functions
- `src/db.ts` — `withUserContext(userId, fn)`: runs `fn` in a transaction with
  `app.current_user_id` set, over a connection that has no `BYPASSRLS`, so policies are
  actually enforced
- `src/assertRole.ts` — the application-layer authorization guard (one of three layers;
  the database is the one that actually matters)
- `src/audit.ts` — `writeAuditEvent()`

## Running it

```bash
docker compose up -d postgres     # from the repo root
pnpm --filter @bp/core exec tsx scripts/create-db.ts   # DATABASE_URL defaults to bp_core
pnpm --filter @bp/core run migrate
pnpm --filter @bp/core test
```

## Project context for AI assistants

Full spec and phase-by-phase Build State checklist:

```
.claude/skills/helio-saas-platform/SKILL.md
```

Read it before writing code here; update its Build State checklist when a phase lands.
