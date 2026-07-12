# Relay

> Webhook delivery infrastructure — HMAC-signed payloads, exponential-backoff retries with jitter, endpoint circuit-breaking, replay, and a dead-letter queue.

**Stack:** Next.js 15 (App Router) · TypeScript (strict) · Tailwind · FastAPI · Postgres

---

## The problem this repository solves

**Delivery is at-least-once. This is stated plainly rather than hidden, because the alternative claim would be a lie.**

Every request carries a stable `Relay-Message-Id` that does not change across retries, so receivers can deduplicate. Payloads are signed as `HMAC-SHA256(secret, "{id}.{timestamp}.{body}")` with the timestamp *inside* the signed material, so a captured request cannot be replayed later. Endpoints can hold multiple active secrets, so rotation costs no downtime.

Retries back off exponentially — 5s, 30s, 5m, 30m, 2h, 5h, 10h — **with full jitter**. Without jitter, an endpoint that goes down and comes back is hit by every queued retry in the same millisecond and immediately falls over again. `4xx` responses are never retried: the receiver is telling you the request is malformed, and sending it eight more times will not help.

After sustained failure an endpoint's circuit opens: delivery stops, messages queue, the owner is notified, and a single probe request tests recovery. When it closes, the backlog drains under a rate limit rather than as a thundering herd.

The worker consumes from a Redis Stream via a consumer group, so `XAUTOCLAIM` reclaims messages from workers that died mid-delivery. That is the crash-safety story.

---

## Architecture decisions

### At-least-once, stated explicitly

Exactly-once delivery over an unreliable network to a third-party endpoint is not achievable. The honest design gives consumers a stable idempotency key and documents the guarantee precisely. Anything else is marketing.

### Full jitter on exponential backoff

`min(cap, base * 2^n)` then `random(0, delay)`. Deterministic backoff synchronizes all pending retries for a recovering endpoint into a single instant and re-kills it. Jitter is the difference between a retry policy and an accidental DDoS.

### Never retry 4xx

A 4xx is the receiver rejecting the request itself. Retrying wastes both sides' capacity and delays the dead-letter signal the sender actually needs. 5xx, 429, and network/timeout errors retry; `Retry-After` is honoured.

### Ingest and delivery are separate processes

The ingest API writes to Postgres, pushes to the stream, and returns 202 in under 50ms at p99. It cannot be allowed to block on a customer's slow endpoint. This separation is the architecture.

### Response bodies truncated to 2KB

Receivers return 500KB HTML error pages under load. Storing them uncapped eats the database during exactly the incident you need the logs for.

### Ship the verification helper, not just the sender

Signature verification is the half of the integration that developers get wrong, and it is the half most SDKs omit.

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
.claude/skills/relay-webhooks/SKILL.md
```

It is the single source of truth. Read it before changing anything; update its **Build State**
checklist when you finish a phase.

---

## Status

Scaffolded. See the Build State checklist in the skill file above for what is done and what is next.
