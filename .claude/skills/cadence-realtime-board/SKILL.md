---
name: cadence-realtime-board
description: Full project context for Cadence — a real-time collaborative project board (Next.js 15 + Supabase Realtime/WebSockets + optimistic UI + presence and live cursors). Use this skill whenever working on Cadence in any way — building the board or card UI, drag-and-drop, presence avatars, live cursors, broadcast channels, optimistic updates and rollback, conflict resolution, fractional-index ordering, or comments. Trigger this even when the user doesn't say "Cadence" explicitly — any mention of the real-time board, the collaborative kanban, live cursors, presence, the "Cadence" design system, or Board/Column/Card/Presence entities qualifies. Read this before generating any Cadence code so the realtime architecture, ordering scheme, colors, and type stay consistent, and update the Build State checklist at the end of every session.
---

# Cadence — Real-Time Collaborative Board

**Portfolio thesis:** most portfolio CRUD apps are request/response. Real-time collaboration is where you have to reason about *state that two people are editing at once* — optimistic updates, rollback, ordering under concurrency, presence. It's the single clearest signal that you can build a hard frontend.

**One-liner:** *A collaborative project board with sub-100ms sync — live cursors, presence, optimistic drag-and-drop, and conflict-free card ordering across simultaneous editors.*

---

## Stack

- **Frontend:** Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui
- **Realtime:** Supabase Realtime — Postgres Changes (durable state), Broadcast (cursors, ephemeral), Presence (who's here)
- **Drag & drop:** `dnd-kit` (not react-beautiful-dnd — unmaintained)
- **State:** Zustand for board state + optimistic mutation queue; TanStack Query for initial fetch/hydration
- **Motion:** Framer Motion — layout animations on card move only, 150ms, no bounce
- **DB:** Supabase Postgres with RLS
- **Deploy:** Vercel

## Design system — "Cadence"

Light, paper-like, calm. The UI recedes so the board is the subject.

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#FBFAF7` | app background |
| `card` | `#FFFFFF` | cards, columns |
| `ink` | `#191A17` | primary text |
| `graphite` | `#5C5E58` | secondary text |
| `rule` | `#E4E2DB` | borders |
| `coral` | `#E2563C` | primary accent, CTA |
| `cobalt` | `#2D5BE3` | selection, focus ring |
| `mint` | `#17A673` | done / success |

**Presence palette** (deterministic per-user, hash `user_id` → index):
`#E2563C` `#2D5BE3` `#17A673` `#B45FD6` `#E0A526` `#0FA3A3` `#D6417E` `#7C6BE8`

**Type:** `Bricolage Grotesque` (board titles, display) · `Inter` (UI/body) · `JetBrains Mono` (timestamps, ids)
**Rules:** cards have `1px` `rule` borders and a single soft shadow (`0 1px 2px rgb(0 0 0 / 0.04)`), radius `10px`. No gradients. Drag shadow is the *only* elevated element on the page.

---

## Data model

```
Board ──< Column ──< Card ──< Comment
  │                    │
  └──< BoardMember     └──< Label (m2m)
```

- `boards` — id, name, created_by
- `board_members` — board_id, user_id, role (`editor` | `viewer`)
- `columns` — board_id, title, position (**text**, see ordering)
- `cards` — column_id, title, description, position (**text**), assignee_id, updated_at, updated_by
- `comments` — card_id, author_id, body, created_at
- `labels` / `card_labels`

### Ordering: fractional indexing (do not use integer positions)

Integer `position` columns require renumbering siblings on every move — which is a write storm and produces conflicts when two people drag at once. Instead store `position` as a **lexicographically sortable string** and generate a key *between* the two neighbours.

Use `fractional-indexing` (npm). Moving a card is a **single-row update** — no neighbours touched, so two concurrent drags in different parts of the board never conflict.

```ts
import { generateKeyBetween } from "fractional-indexing";
const newPos = generateKeyBetween(prevCard?.position ?? null, nextCard?.position ?? null);
```

If two users drop cards into the *same* slot simultaneously, both get valid keys and land adjacent — deterministic tiebreak by `id`. That's the whole conflict story. Explain this in the README; it's the paragraph that gets you the interview.

---

## Realtime architecture

Three channels, three different jobs. Getting this separation right is the point.

**1. Postgres Changes — durable state**
Subscribe to INSERT/UPDATE/DELETE on `cards`, `columns`, `comments` filtered by `board_id`. This is the source of truth. Apply incoming changes to the Zustand store, *reconciling against pending optimistic mutations* (see below).

**2. Broadcast — ephemeral, high-frequency**
Cursor positions and "X is dragging card Y". Never hits the database. **Throttle cursor broadcasts to ~30/sec** (`requestAnimationFrame` + a 33ms gate) or you will flood the socket.

**3. Presence — who's on the board**
Track `{ user_id, name, avatar_url, color }`. Render as a stacked avatar row in the header. Handle join/leave to drop stale cursors.

### Optimistic updates + rollback

This is the hard part; write it carefully.

```
1. User drags card → apply to local store immediately, push { mutationId, prevState } onto a pending queue
2. Fire the Supabase update
3a. Success → pop from queue
3b. Failure → replay prevState, pop from queue, toast "Couldn't move card"
4. Incoming realtime event → if its row has a pending local mutation, IGNORE it
   (our optimistic state is newer). Otherwise apply.
```

Without step 4 you get the classic flicker: your card snaps back to the old position for one frame when your own change echoes back from the server. Interviewers notice this bug in a demo.

**Reconnection:** on `SUBSCRIBED` after a disconnect, refetch the full board and hard-reset the store. Deltas missed while offline are unrecoverable; don't try to be clever.

---

## Routes

```
/                       marketing / landing
/login
/boards                 board list
/boards/[id]            the board (the whole product)
/boards/[id]/card/[cardId]   card detail — parallel route as a modal, deep-linkable
```

---

## Conventions

- Board page is a Client Component (it's inherently interactive); everything above it is a Server Component.
- All realtime subscription setup lives in one hook: `useBoardRealtime(boardId)`. Do not scatter `.channel()` calls.
- Clean up channels in the effect return. A leaked channel is a memory leak *and* a duplicate-event bug.
- Commit directly to `main` unless told otherwise.

---

## Build state

Update this every session. Fresh sessions read this first to know where to resume.

**Phase 1 — Static board**
- [ ] Scaffold Next.js 15 + Cadence tokens + shadcn/ui
- [ ] Supabase schema: boards, columns, cards, board_members + RLS
- [ ] Board renders from server data; columns + cards, no interactivity
- [ ] Install `fractional-indexing`; seed cards with generated keys

**Phase 2 — Local interactivity**
- [ ] `dnd-kit` drag-and-drop within and across columns
- [ ] Zustand store + optimistic mutation queue with rollback
- [ ] Card create / edit / delete, column create / rename
- [ ] Card detail modal via parallel route

**Phase 3 — Realtime**
- [ ] `useBoardRealtime` hook: Postgres Changes subscription
- [ ] Pending-mutation reconciliation (kill the echo flicker)
- [ ] Presence: avatar stack in header, join/leave handling
- [ ] Broadcast: live cursors, throttled to ~30fps, colored per user
- [ ] "Sarah is dragging…" ghost indicator on remotely-held cards
- [ ] Reconnection: refetch + store reset on resubscribe

**Phase 4 — Depth & proof**
- [ ] Comments with realtime append
- [ ] Labels, assignees, filters
- [ ] Keyboard nav + full a11y pass on drag (dnd-kit sensors)
- [ ] Playwright multi-context test: two browsers, one board, assert convergence
- [ ] README: the fractional-indexing explanation + a recorded two-cursor demo GIF
- [ ] Deploy; seed a public demo board that anyone can open in two tabs

## What Patrick needs to provide

- Supabase project URL + anon key + service role key
- Confirmation of the name "Cadence" (or an alternative)
- Optional: a short screen recording of two tabs side by side for the portfolio hero — this demo *is* the sales pitch, more than any screenshot
