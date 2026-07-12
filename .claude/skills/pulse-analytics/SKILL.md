---
name: pulse-analytics
description: Full project context for Pulse — a self-hosted product analytics platform (Next.js 15 dashboard + FastAPI ingestion API + Postgres with time-partitioned event tables) featuring funnels, retention cohorts, session replay-lite, and a TypeScript tracking SDK. Use this skill whenever working on Pulse in any way — the ingestion endpoint, event schema, batching or partitioning, funnel and retention SQL, cohort grids, chart components, the query builder UI, or the npm tracking SDK. Trigger this even when the user doesn't say "Pulse" explicitly — any mention of the analytics project, event ingestion, funnel or retention or cohort analysis, the "Pulse" design system, or Event/Funnel/Cohort/Property entities qualifies. Read this before generating any Pulse code so the event schema, SQL patterns, colors, and type stay consistent, and update the Build State checklist at the end of every session.
---

# Pulse — Product Analytics Platform

**Portfolio thesis:** this is the data-engineering + data-visualisation proof. It shows you can design a write-heavy schema, write genuinely hard SQL (funnels and retention are hard SQL), and render dense information legibly. It's also the project where a hiring manager thinks *"wait, he rebuilt a piece of Mixpanel."*

**One-liner:** *A self-hosted product analytics engine — high-throughput event ingestion, funnel conversion analysis, retention cohorts, and a drag-to-build query interface, on plain Postgres.*

---

## Stack

- **Ingestion API:** FastAPI — single high-throughput endpoint, batched writes
- **Dashboard:** Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui
- **Charts:** Recharts for standard charts; hand-rolled SVG for the retention cohort grid (no library does it well)
- **DB:** Postgres — declarative **time-partitioned** `events` table, monthly partitions
- **Cache:** Redis for materialized query results (funnels over millions of rows are not sub-second from cold)
- **SDK:** a small TypeScript package (`@pulse/tracker`) — publishable, another portfolio artifact
- **Deploy:** Vercel (dashboard) + Railway (API + Redis) + Supabase/Neon (DB)

## Design system — "Pulse"

Dark, dense, instrument-panel. Data-ink ratio is the whole aesthetic — chrome disappears, data doesn't.

| Token | Hex | Use |
|---|---|---|
| `void` | `#0A0C0F` | app background |
| `panel` | `#12161B` | chart cards |
| `grid` | `#1E252D` | gridlines, borders |
| `text` | `#DCE3EA` | primary text |
| `muted` | `#7C8895` | axes, labels, secondary |
| `azure` | `#3BA0FF` | primary series, CTA |

**Categorical series palette** (in order — colorblind-safe, no red/green adjacency):
`#3BA0FF` `#35D0A0` `#F2C14E` `#F2704E` `#A47BF2` `#5FD3E0` `#E0709E` `#8C99A6`

**Sequential scale** for the retention grid (low → high): `#12161B` → `#12324A` → `#164E72` → `#1A6C9C` → `#238CC4` → `#3BA0FF`

**Type:** `Space Grotesk` (headings, big numbers) · `Inter` (UI) · `IBM Plex Mono` (**all numerics in tables — tabular figures, `font-variant-numeric: tabular-nums`**)
**Rules:** no gridline unless it aids reading. No chart borders. No 3D, no donut charts, no dual axes. Axis labels in `muted` at 12px. Radius `6px`. Charts get *one* accent color unless the series is genuinely categorical.

---

## Event schema

One wide table, partitioned by time. Resist the urge to normalize event properties — you'll regret the joins.

```sql
create table events (
  id           uuid default gen_random_uuid(),
  project_id   uuid not null,
  event_name   text not null,
  distinct_id  text not null,          -- the user
  session_id   text,
  timestamp    timestamptz not null,
  properties   jsonb not null default '{}',
  -- denormalized context, extracted at ingest for fast filtering:
  country      text,
  device_type  text,
  browser      text,
  referrer     text,
  path         text,
  primary key (id, timestamp)
) partition by range (timestamp);

create index on events (project_id, event_name, timestamp desc);
create index on events (project_id, distinct_id, timestamp);
create index on events using gin (properties jsonb_path_ops);
```

- **Partition monthly.** Write a `pg_cron` job (or a startup task) that pre-creates next month's partition. Old partitions detach and archive cheaply — this is the whole reason to partition, and it's the answer to "how would you handle scale?"
- Also: `projects`, `persons` (distinct_id → first_seen, last_seen, merged properties), `funnels` (saved definitions), `dashboards`.
- **Identity merge:** anonymous `distinct_id` → identified user. Keep an `person_aliases` table; on `identify()`, alias the anon id. Handle it at query time via a lookup, not by rewriting history.

---

## The hard SQL (this is the portfolio content)

### Funnels — ordered steps within a conversion window

The naive self-join approach breaks at 4+ steps. Use a window function over a single scan:

```sql
with stepped as (
  select
    distinct_id,
    timestamp,
    case event_name
      when 'signup_started'   then 1
      when 'email_verified'   then 2
      when 'project_created'  then 3
      when 'subscribed'       then 4
    end as step
  from events
  where project_id = $1
    and event_name in ('signup_started','email_verified','project_created','subscribed')
    and timestamp between $2 and $3
),
sequenced as (
  select distinct_id, step, timestamp,
    max(step) over (
      partition by distinct_id
      order by timestamp
      rows between unbounded preceding and current row
    ) as max_step_so_far
  from stepped
)
-- a user reaches step N only if they hit steps 1..N in order, within the window
select step, count(distinct distinct_id) as users
from sequenced
where step = max_step_so_far
group by step order by step;
```

Then add the **conversion window** (steps must complete within e.g. 7 days of step 1) and **time-to-convert** percentiles. Also compute drop-off % between steps, and let the user click a step to see the users who dropped.

### Retention — cohort grid

```sql
with cohorts as (
  select distinct_id, date_trunc('week', min(timestamp)) as cohort_week
  from events where project_id = $1 group by distinct_id
),
activity as (
  select e.distinct_id, c.cohort_week,
    floor(extract(epoch from (date_trunc('week', e.timestamp) - c.cohort_week)) / 604800)::int as week_offset
  from events e join cohorts c using (distinct_id)
  where e.project_id = $1
)
select cohort_week, week_offset,
       count(distinct distinct_id) as retained
from activity
where week_offset >= 0
group by 1, 2;
```

Render as a triangular heatmap using the sequential scale. Row = cohort, column = weeks since, cell = % of cohort still active. Cells fade toward `void` as retention drops. This chart, done well, is the screenshot for the portfolio card.

### Performance
Funnel and retention queries over millions of rows are not sub-second. **Cache aggressively in Redis** keyed by `hash(query_definition + date_range)`, TTL 5 min, with a "last computed at" stamp in the UI. Be honest about it — showing that you *know* the query is expensive and handled it is better than pretending it's free.

---

## Routes

```
/                             landing + live demo link
/[project]/overview           DAU/WAU/MAU, top events, trend sparklines
/[project]/events             live event stream (SSE) + filterable table
/[project]/funnels            funnel builder (drag steps) + conversion chart
/[project]/retention          cohort grid
/[project]/explore            ad-hoc query builder: event + breakdown + filter + chart type
/[project]/people             person profiles with event timeline
/[project]/settings           API keys, project setup, SDK snippet

API
POST /capture                 single event
POST /batch                   batched events (the SDK's default)
```

---

## The SDK — `@pulse/tracker`

Small, dependency-free, ~3kb. Publish it to npm; a public package on your GitHub is disproportionately persuasive.

```ts
pulse.init({ apiKey, host });
pulse.capture("project_created", { plan: "pro" });
pulse.identify("user_123", { email });
pulse.page();
```

Must handle: batching (flush every 5s or 20 events), `navigator.sendBeacon` on `visibilitychange` so events aren't lost on tab close, retry with backoff, and a queue that survives before `init()` resolves.

---

## Conventions

- Ingestion endpoint returns `202` immediately and writes async. It must never block on the DB — that's the "high-throughput" claim.
- Validate events with Pydantic but **never reject on unknown properties** — analytics ingestion is append-anything by nature.
- All chart components take data as props and are pure — no fetching inside chart components.
- Commit directly to `main` unless told otherwise.

---

## Build state

Update this every session. Fresh sessions read this first to know where to resume.

**Phase 1 — Ingestion**
- [ ] FastAPI `/capture` + `/batch`, API key auth, 202 + async write
- [ ] Partitioned `events` table + indexes + partition pre-creation job
- [ ] `projects`, `persons`, `person_aliases`
- [ ] Context extraction (UA parse → device/browser; IP → country)
- [ ] Load test: confirm and record the ingestion rate (put the number in the README)

**Phase 2 — SDK**
- [ ] `@pulse/tracker` — capture, identify, page, batching, sendBeacon, retry
- [ ] Build with tsup, publish to npm
- [ ] Copy-paste snippet on the settings page

**Phase 3 — Dashboard core**
- [ ] Next.js scaffold + Pulse tokens; chart primitives (line, bar, big-number)
- [ ] Overview: DAU/WAU/MAU, top events, trends
- [ ] Live event stream via SSE
- [ ] Explore: ad-hoc query builder

**Phase 4 — The hard ones**
- [ ] Funnel query (window-function version) + conversion window + time-to-convert
- [ ] Funnel builder UI with drag-to-reorder steps
- [ ] Retention cohort SQL + triangular heatmap grid
- [ ] Redis caching layer + "computed at" indicator
- [ ] Person profiles with event timeline

**Phase 5 — Proof**
- [ ] Seed a realistic synthetic dataset (~2M events, believable funnel drop-off and retention decay — a flat cohort grid looks fake)
- [ ] `EXPLAIN ANALYZE` before/after the partition + index work → put the numbers in the README
- [ ] Deploy; public demo project with read-only access

## What Patrick needs to provide

- Postgres (Neon or Supabase) + Redis (Railway/Upstash)
- npm account for publishing the SDK
- A decision on the demo dataset story — easiest and most coherent: **generate synthetic events for one of your own products (Oghie Store or Helio)**, so the funnel steps read as real (`viewed_product → added_to_cart → checkout_started → purchased`) and the projects cross-reference each other on your portfolio site.
