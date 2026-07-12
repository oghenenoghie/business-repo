# Helio

> Multi-tenant B2B SaaS foundation — organizations, seat-based Stripe billing, RBAC, and Postgres RLS that provably isolates tenants.

**Stack:** Next.js 15 (App Router) · TypeScript (strict) · Tailwind · Supabase Postgres

---

## The problem this repository solves

**Tenant isolation is enforced at the database layer, not the application layer.**

Every tenant-scoped table carries `org_id` and is guarded by a Postgres row-level security policy that resolves membership through `auth.uid()`. Even if an API route forgets a `where` clause — even if it is actively malicious — the database returns zero rows.

`tests/rls.spec.ts` proves it: it authenticates as a member of Org A and attempts every read and write against Org B's rows. All of them fail. That test suite is the point of this repository.

---

## Architecture decisions

### Row-level security over application-layer filtering

App-layer `where org_id = ?` filtering is one forgotten clause away from a cross-tenant data leak — the single most expensive bug class in B2B SaaS. RLS makes the leak structurally impossible. Authorization is enforced in three layers (database, server-action guard, UI), but only the database one actually matters.

### Stripe webhooks are the source of truth, not the checkout redirect

Users close the tab. Networks drop. If subscription state is written on redirect, some percentage of paying customers end up unprovisioned. All subscription state is written from `customer.subscription.*` webhook events, with signature verification and an idempotency table keyed on `stripe_event_id`, because Stripe retries.

### Seat count syncs to Stripe on membership change

Seat-based billing drifts silently if invites and subscription quantity are updated independently. Membership changes update the Stripe subscription quantity in the same flow, and invites are blocked at the seat ceiling.

### Composite primary key on memberships

`(org_id, user_id)` makes duplicate membership unrepresentable rather than something to defensively check for.

---

## Running it

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev
```

Database migrations are in `supabase/migrations/`, applied in order.

---

## Project context for AI assistants

The complete specification for this project — stack, design system, data model, feature spec,
and a phase-by-phase build checklist — is committed at:

```
.claude/skills/helio-saas-platform/SKILL.md
```

It is the single source of truth. Read it before changing anything; update its **Build State**
checklist when you finish a phase.

---

## Status

Scaffolded. See the Build State checklist in the skill file above for what is done and what is next.
