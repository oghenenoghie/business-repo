# Cadence

> Real-time collaborative board — live cursors, presence, optimistic drag-and-drop, and conflict-free card ordering across simultaneous editors.

**Stack:** Next.js 15 (App Router) · TypeScript (strict) · Tailwind · Supabase Postgres

---

## The problem this repository solves

**Two people dragging cards on the same board at the same time must converge — without a single card snapping back, duplicating, or landing in the wrong place.**

Card order is stored as a *fractional index*: a lexicographically sortable string generated between the two neighbours of the drop target. Moving a card is a single-row update — no siblings are renumbered — so concurrent drags in different parts of the board cannot conflict at all, and concurrent drags into the *same* slot both produce valid keys and land adjacent.

Local edits apply optimistically against a pending-mutation queue. When the change echoes back over the realtime channel, it is *ignored* if a local mutation for that row is still pending — which is what kills the one-frame snap-back flicker that most collaborative UIs ship with.

---

## Architecture decisions

### Fractional indexing over integer positions

Integer `position` columns require renumbering every sibling on each move: a write storm, and a guaranteed conflict when two people drag simultaneously. Fractional string keys make a move a single-row update. This is the entire conflict-resolution story.

### Three separate realtime channels, not one

Postgres Changes carries durable state. Broadcast carries cursors — ephemeral, ~30/sec, never touching the database. Presence carries who is on the board. Collapsing these into one channel means either flooding the database with cursor writes or losing durability on real edits.

### Optimistic writes reconciled against a pending queue

Applying every inbound realtime event unconditionally means your own change echoes back and briefly reverts your card. The pending-mutation queue is what makes local edits feel instant and remote edits feel live.

### Full board refetch on reconnect

Deltas missed while the socket was down are unrecoverable. Refetching and hard-resetting the store on resubscribe is correct; attempting to replay a gap is a bug factory.

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
.claude/skills/cadence-realtime-board/SKILL.md
```

It is the single source of truth. Read it before changing anything; update its **Build State**
checklist when you finish a phase.

---

## Status

Scaffolded. See the Build State checklist in the skill file above for what is done and what is next.
