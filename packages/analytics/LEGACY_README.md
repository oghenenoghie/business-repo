# Pulse

> Self-hosted product analytics — high-throughput event ingestion, funnel conversion analysis, retention cohorts, and a published tracking SDK. On plain Postgres.

**Stack:** Next.js 15 (App Router) · TypeScript (strict) · Tailwind · FastAPI · Postgres

---

## The problem this repository solves

**Funnels and retention are hard SQL, and event tables are write-heavy. Both facts shape every decision in this repo.**

The naive funnel implementation self-joins the events table once per step. It works for three steps and falls over at five. This one computes ordered step completion in a single scan using a window function (`max(step) over (partition by distinct_id order by timestamp ...)`), then applies the conversion window and time-to-convert percentiles on top.

The `events` table is declaratively **partitioned by month**. Queries hit one or two partitions instead of the full history, and old data detaches and archives in constant time. `docs/BENCHMARKS.md` carries the `EXPLAIN ANALYZE` output before and after partitioning and indexing — the numbers, not the claim.

Funnel and retention queries over millions of rows are not sub-second, and the UI does not pretend otherwise: results are cached in Redis keyed on the query definition, with the compute timestamp shown to the user.

---

## Architecture decisions

### One wide, time-partitioned events table

Normalizing event properties into an EAV table is the classic mistake — it turns every query into a pivot. Properties live in a `jsonb` column with a GIN index; high-cardinality filter dimensions (country, device, path) are extracted to real columns at ingest. Monthly range partitions keep queries and retention policy cheap.

### Ingestion returns 202 and writes asynchronously

The capture endpoint must never block on the database, or a slow write turns into dropped events from every client at once. Validation is permissive by design: analytics ingestion rejects nothing for unknown properties.

### Window function funnels, not self-joins

N self-joins for an N-step funnel is O(rows^N) in the worst case. A single ordered scan with a running max of completed steps is linear, and it extends to arbitrary step counts for free.

### Redis-cached aggregates with visible staleness

Honest engineering beats a fake loading spinner. The dashboard shows when each figure was computed.

### Ship the SDK

A published, dependency-free npm package with `sendBeacon` flush-on-unload and retry-with-backoff is a portfolio artifact in its own right — and it is where events actually get lost if you get it wrong.

---

## Running it

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev
```

The API lives in `api/`:

```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

Database migrations are in `supabase/migrations/`, applied in order.

---

## Project context for AI assistants

The complete specification for this project — stack, design system, data model, feature spec,
and a phase-by-phase build checklist — is committed at:

```
.claude/skills/pulse-analytics/SKILL.md
```

It is the single source of truth. Read it before changing anything; update its **Build State**
checklist when you finish a phase.

---

## Status

Scaffolded. See the Build State checklist in the skill file above for what is done and what is next.
