---
name: helio-saas-platform
description: Full project context for Helio — a multi-tenant B2B SaaS platform (Next.js 15 App Router + Supabase Postgres/RLS + Stripe Billing). Use this skill whenever working on Helio in any way — building pages or components, writing schema/migrations/RLS policies, wiring Stripe subscriptions or webhooks, implementing org/workspace/seat/invite/RBAC logic, the audit log, or deployment. Trigger this even when the user doesn't say "Helio" explicitly — any mention of the multi-tenant SaaS, the billing project, org/seat/invite flows, the "Helio" design system, or Organization/Membership/Subscription entities qualifies. Read this before generating any Helio code so schema, colors, type, and conventions stay consistent, and update the Build State checklist at the end of every session.
---

# Helio — Multi-Tenant B2B SaaS Platform

**Portfolio thesis:** every SaaS company screens for the same three things — can you model multi-tenancy without leaking data across tenants, can you take money reliably, and can you handle roles/permissions. Helio is a single artifact that answers all three.

**One-liner for the portfolio site:** *A production-grade multi-tenant SaaS foundation: organizations, seat-based Stripe billing, role-based access control, and Postgres row-level security that provably isolates tenants.*

---

## Stack

- **Frontend:** Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui, Framer Motion (restrained — fade/slide only)
- **Backend:** Next.js Route Handlers + Server Actions
- **Database:** Supabase Postgres. RLS on **every** tenant table, no exceptions
- **Auth:** Supabase Auth (email magic link + Google OAuth)
- **Payments:** Stripe Billing — subscriptions, seat-based quantity, customer portal, webhooks
- **Email:** Resend (invites, receipts, seat-limit warnings)
- **Deploy:** Vercel + Supabase cloud; GitHub Actions for typecheck/test/lint

## Design system — "Helio"

Dark-first product UI. Confident and dense, not a marketing site.

| Token | Hex | Use |
|---|---|---|
| `graphite` | `#14161A` | app background |
| `surface` | `#1C1F26` | cards, panels |
| `line` | `#2A2F38` | borders, dividers |
| `text` | `#E7E9EE` | primary text |
| `muted` | `#9BA3B0` | secondary text |
| `iris` | `#6C5CE7` | primary accent / CTA |
| `positive` | `#2FBF71` | active, paid, success |
| `warning` | `#E0A526` | past-due, seat limit |
| `danger` | `#E5484D` | destructive, canceled |

**Type:** `Inter Tight` (headings, tight tracking) · `Inter` (body) · `JetBrains Mono` (IDs, keys, amounts)
**Rules:** no gradients, no glassmorphism, no shadow-heavy cards. Depth comes from `line` borders and one-step surface elevation. Radius `8px`. Marketing pages may go light-mode on `#FAFAFA`, but the app is dark.

---

## Data model

```
Organization ──< Membership >── User
     │                              
     ├──< Invite                    
     ├──< Subscription ──< Plan     
     ├──< Project (the "work" entity — keep it thin, it's not the point)
     └──< AuditEvent
```

- `organizations` — id, name, slug, stripe_customer_id, created_at
- `memberships` — org_id, user_id, role (`owner` | `admin` | `member` | `viewer`), created_at. **Composite PK (org_id, user_id).**
- `invites` — org_id, email, role, token (hashed), expires_at, accepted_at
- `subscriptions` — org_id, stripe_subscription_id, plan_id, status, seats, current_period_end, cancel_at_period_end
- `plans` — id, name, stripe_price_id, seat_price_cents, features (jsonb)
- `projects` — org_id, name, description, created_by
- `audit_events` — org_id, actor_id, action, target_type, target_id, metadata (jsonb), created_at

### The RLS pattern (this is the part interviewers care about)

Every tenant table carries `org_id`. Access is granted only through membership:

```sql
create policy "members read own org rows"
on projects for select
using (
  org_id in (
    select org_id from memberships where user_id = auth.uid()
  )
);
```

Writes additionally check role. Wrap the role check in a `security definer` function so it's one place, not copy-pasted:

```sql
create function has_org_role(target_org uuid, allowed text[])
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from memberships
    where org_id = target_org and user_id = auth.uid() and role = any(allowed)
  );
$$;
```

**Prove the isolation.** Ship a test suite (`tests/rls.spec.ts`) that authenticates as a user in Org A and asserts that every query against Org B's rows returns zero rows or a permission error. This test file is the single most impressive artifact in the repo — link it directly from the README.

---

## Permission matrix

| Action | owner | admin | member | viewer |
|---|:-:|:-:|:-:|:-:|
| View projects | ✓ | ✓ | ✓ | ✓ |
| Create/edit projects | ✓ | ✓ | ✓ | — |
| Invite members | ✓ | ✓ | — | — |
| Change roles | ✓ | ✓ | — | — |
| Remove members | ✓ | ✓ | — | — |
| Manage billing | ✓ | — | — | — |
| Delete org | ✓ | — | — | — |
| Transfer ownership | ✓ | — | — | — |

Enforce this in **three** layers: RLS (database), server action guard (`assertRole()`), and UI (hide/disable). Interviewers ask "where do you enforce authz?" — the correct answer is "all three, and the database is the one that actually matters."

---

## Billing — the details that separate juniors from seniors

1. **Webhooks are the source of truth**, not the checkout redirect. The user can close the tab. Handle `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
2. **Verify the webhook signature** with `stripe.webhooks.constructEvent`. Read the raw body — Next.js Route Handlers need `await req.text()`, not `req.json()`.
3. **Idempotency.** Stripe retries. Store `stripe_event_id` in a `processed_webhook_events` table with a unique constraint and no-op on conflict.
4. **Seat sync.** When a member is added/removed, update the Stripe subscription quantity. Block invites when `seats_used >= seats` and surface an upgrade CTA.
5. **Dunning.** On `invoice.payment_failed`, set status `past_due`, show a persistent banner, email the owner. After the grace period, downgrade to read-only rather than deleting anything.
6. **Local testing:** `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

---

## Routes

```
/                          marketing (light mode)
/pricing
/login  /signup
/onboarding                create first org
/[orgSlug]                 dashboard
/[orgSlug]/projects
/[orgSlug]/settings/general
/[orgSlug]/settings/members     invite, role change, remove
/[orgSlug]/settings/billing     plan, seats, portal link, invoices
/[orgSlug]/settings/audit       filterable audit log
/invite/[token]                 accept invite
/api/webhooks/stripe
```

---

## Conventions

- Server Components by default; `"use client"` only for interactivity.
- Mutations via Server Actions, validated with Zod at the boundary. Never trust the client-sent `org_id` — derive it from the session + slug.
- Every mutation writes an `audit_events` row. Do it in the same transaction.
- Commit directly to `main` unless told otherwise.

---

## Build state

Update this every session. Fresh sessions read this first to know where to resume.

**Phase 1 — Foundation**
- [ ] `create-next-app`, TS strict, Tailwind + Helio tokens, shadcn/ui init
- [ ] Supabase project, auth (magic link + Google)
- [ ] Migration 001: orgs, memberships, invites, projects, audit_events
- [ ] RLS policies + `has_org_role()` helper
- [ ] `tests/rls.spec.ts` — cross-tenant isolation suite (**do not skip**)

**Phase 2 — Tenancy & RBAC**
- [ ] Onboarding: create org, become owner
- [ ] Org switcher + `[orgSlug]` layout with membership guard
- [ ] Members page: invite by email (Resend), accept flow, role change, remove
- [ ] `assertRole()` server guard + UI permission gating
- [ ] Audit log page with filters

**Phase 3 — Billing**
- [ ] Plans + Stripe products/prices, pricing page
- [ ] Checkout session → subscription
- [ ] Webhook handler + signature verification + idempotency table
- [ ] Seat counting, seat-limit enforcement on invite
- [ ] Customer portal link, invoice list
- [ ] Dunning banner + `past_due` read-only mode

**Phase 4 — Polish & proof**
- [ ] Projects CRUD (thin — it exists so the tenancy has something to isolate)
- [ ] Empty states, loading skeletons, error boundaries
- [ ] Playwright E2E: signup → create org → invite → subscribe → seat limit
- [ ] GitHub Actions: typecheck, lint, unit, RLS suite, E2E
- [ ] README with architecture diagram, the RLS explanation, and a demo login
- [ ] Deploy to Vercel; seed a demo org with realistic data

## What Patrick needs to provide

- Supabase project URL + anon key + service role key
- Stripe test-mode secret key + webhook signing secret
- Resend API key + a verified sending domain
- Product name confirmation (keeping "Helio" unless told otherwise)
