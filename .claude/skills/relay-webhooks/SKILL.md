---
name: relay-webhooks
description: Full project context for Relay — a webhook delivery infrastructure service (FastAPI + Postgres + Redis queue + Next.js dashboard) with HMAC signing, exponential-backoff retries, circuit breaking, replay, rate limiting, and a published TypeScript SDK plus docs site. Use this skill whenever working on Relay in any way — the ingest endpoint, delivery worker, retry/backoff logic, dead-letter queue, signature scheme, endpoint health and circuit breaking, idempotency, the dashboard, the SDK, or the docs. Trigger this even when the user doesn't say "Relay" explicitly — any mention of the webhook project, webhook delivery or retries, HMAC signing, dead-letter queues, the "Relay" design system, or Endpoint/Message/DeliveryAttempt entities qualifies. Read this before generating any Relay code so the delivery semantics, colors, and type stay consistent, and update the Build State checklist at the end of every session.
---

# Relay — Webhook Delivery Infrastructure

**Portfolio thesis:** this is the backend-craft project. No pretty UI carries it — it's judged on whether the distributed-systems reasoning is sound. Retries, idempotency, backoff, circuit breaking, at-least-once delivery, poison messages. Backend and platform teams read a repo like this and immediately know your level.

**One-liner:** *Reliable webhook delivery as a service — signed payloads, exponential-backoff retries with jitter, automatic endpoint circuit-breaking, replay, and a dead-letter queue. With an npm SDK and a docs site.*

---

## Stack

- **API + worker:** FastAPI (ingest) + a separate async worker process (delivery). **They must be separate processes** — that separation *is* the architecture.
- **Queue:** Redis (Streams, with consumer groups — not a naive list; Streams give you ack/pending/claim semantics for free)
- **DB:** Postgres — messages, endpoints, delivery attempts
- **Dashboard:** Next.js 15, TypeScript, Tailwind, shadcn/ui
- **SDK:** `@relay/node` — TypeScript, published to npm
- **Docs:** Nextra or Fumadocs — a real docs site, not a README
- **Deploy:** Railway (API + worker + Redis) + Vercel (dashboard + docs) + Neon/Supabase (DB)

## Design system — "Relay"

Developer-tool aesthetic. Dual theme (dark default), monospace-forward, high information density. Think Stripe docs, not a SaaS landing page.

| Token | Hex (dark) | Hex (light) | Use |
|---|---|---|---|
| `carbon` | `#0D0F12` | `#FFFFFF` | background |
| `panel` | `#15181D` | `#F7F8F9` | cards, code blocks |
| `wire` | `#242A32` | `#E4E6E9` | borders |
| `text` | `#E6E9ED` | `#0D0F12` | primary |
| `muted` | `#8C959F` | `#6B7280` | secondary |
| `teal` | `#0FA3A3` | `#0B7E7E` | primary accent |
| `success` | `#1E9E5A` | — | 2xx delivered |
| `warn` | `#D98A16` | — | retrying |
| `danger` | `#D93A3A` | — | failed / dead-lettered |

**Type:** `IBM Plex Sans` (UI) · `IBM Plex Mono` (**heavily** — IDs, payloads, status codes, headers, timestamps, latencies)
**Rules:** status is communicated by a colored dot + monospace code, never by a pill with a gradient. Payloads render in a proper syntax-highlighted, collapsible JSON viewer. Radius `4px` — sharper than the other projects, deliberately. No decoration.

---

## Data model

```
Application ──< Endpoint ──< DeliveryAttempt
      │                            │
      └──< Message ────────────────┘
```

- `applications` — id, name, owner_id (a customer of Relay)
- `endpoints` — app_id, url, secret, event_types (text[]), status (`enabled`|`disabled`|`circuit_open`), consecutive_failures, disabled_at, rate_limit_rps
- `messages` — app_id, event_type, payload (jsonb), idempotency_key (unique per app), created_at
- `delivery_attempts` — message_id, endpoint_id, attempt_number, status (`pending`|`success`|`failed`), response_status, response_body (truncated to 2KB), duration_ms, error, attempted_at, next_retry_at
- `dead_letters` — message_id, endpoint_id, final_error, dead_lettered_at

---

## Delivery semantics — the core

### Guarantee: at-least-once
State this explicitly in the docs. Consumers **must** be idempotent, so give them what they need to be: a unique `Relay-Message-Id` header that is stable across retries. Saying "at-least-once, here is your idempotency key" is the correct, senior answer. "Exactly-once" is a claim that would be a lie.

### Signing
```
Relay-Id:        msg_2xk9...
Relay-Timestamp: 1720656000
Relay-Signature: v1,base64(hmac_sha256(secret, "{id}.{timestamp}.{body}"))
```
Timestamp is in the signed payload to prevent **replay attacks** — receivers reject anything older than 5 minutes. Support **multiple active secrets** per endpoint so customers can rotate without downtime (sign with all, send comma-separated signatures). Compare with a constant-time comparison; document that too.

### Retry schedule — exponential backoff **with jitter**
```
attempt 1:  immediate
attempt 2:  ~5s
attempt 3:  ~30s
attempt 4:  ~5m
attempt 5:  ~30m
attempt 6:  ~2h
attempt 7:  ~5h
attempt 8:  ~10h   → then dead-letter
```
Compute as `min(cap, base * 2^n)` then apply **full jitter**: `random(0, delay)`. Without jitter, a customer endpoint that goes down and comes back gets hit by every queued retry in the same millisecond — a thundering herd that knocks it straight back over. Being able to explain *why* jitter exists is worth more in an interview than any of the code.

Retry only on `5xx`, `429`, and network/timeout errors. **A `4xx` is the receiver saying "this request is bad" — retrying it is pointless.** Honour `Retry-After` on `429`.

### Circuit breaking
After N consecutive failures (default 20) across the endpoint's recent window, flip to `circuit_open`: stop dispatching, queue messages, email the endpoint owner. Probe periodically with a single request (half-open). On success, close the circuit and drain the backlog **with rate limiting** so the recovery doesn't re-kill them.

### Idempotency on ingest
`Idempotency-Key` header → unique index on `(app_id, idempotency_key)`. Duplicate POST returns the original message, `200`, no new delivery. Clients retry too; you have to survive it.

### Worker
Redis Streams consumer group. `XAUTOCLAIM` reclaims messages from workers that died mid-delivery — that's your crash safety story. Per-endpoint concurrency limit so one slow endpoint can't starve the pool. Timeout every outbound request (default 15s) and treat the timeout as a retryable failure.

---

## Dashboard

The dashboard's job is **debuggability**, which is the actual product of a webhook service.

- **Messages** — searchable by event type, endpoint, status, date. Row expands into the exact payload sent.
- **Attempt timeline** — for one message: every attempt, with request headers, response status, response body, latency, and the error. This screen is the demo.
- **Replay** — resend a single message, or bulk-replay everything that failed in a time window. Non-negotiable feature; every real webhook service has it.
- **Endpoint health** — success rate, p50/p95 latency, circuit state, recent failures.
- **Testing** — send a test event; a live "listening" view (like `stripe listen`) so devs can verify integration.

```
/                       docs-style landing
/docs/*                 the docs site (Nextra/Fumadocs)
/app/[appId]/messages
/app/[appId]/messages/[id]     attempt timeline
/app/[appId]/endpoints
/app/[appId]/endpoints/[id]    health + secret rotation
/app/[appId]/logs              live tail
/app/[appId]/settings          API keys

API
POST /v1/messages       ingest (Idempotency-Key)
GET  /v1/messages/:id
POST /v1/messages/:id/replay
CRUD /v1/endpoints
```

---

## The SDK — `@relay/node`

```ts
const relay = new Relay(process.env.RELAY_API_KEY);
await relay.messages.send({
  eventType: "invoice.paid",
  payload: { invoiceId, amount },
  idempotencyKey: invoiceId,
});

// and the receiver side — this is the half people forget:
relay.webhooks.verify(rawBody, headers, secret); // throws on bad sig or stale timestamp
```
Ship the **verification** helper, not just the sender. Publish to npm.

---

## Conventions

- Ingest never blocks on delivery. `POST /v1/messages` writes to Postgres, pushes to the Redis stream, returns `202` with the message id. Target p99 < 50ms.
- Truncate stored response bodies to 2KB. Customers return 500KB HTML error pages and it will eat the database.
- Structured JSON logs on every attempt (`message_id`, `endpoint_id`, `attempt`, `status`, `duration_ms`).
- Commit directly to `main` unless told otherwise.

---

## Build state

Update this every session. Fresh sessions read this first to know where to resume.

**Phase 1 — Ingest & store**
- [ ] FastAPI scaffold, API key auth, Postgres schema
- [ ] `POST /v1/messages` with idempotency key + unique index
- [ ] Redis Streams producer; 202 response; p99 latency measured
- [ ] Endpoint CRUD + secret generation

**Phase 2 — Delivery worker**
- [ ] Separate worker process, Streams consumer group
- [ ] HMAC signing (multi-secret, timestamp in signed payload)
- [ ] Outbound HTTP with timeout; record `delivery_attempts`
- [ ] Retry schedule: exponential backoff + full jitter, 4xx = no retry, honour `Retry-After`
- [ ] Dead-letter queue after final attempt
- [ ] `XAUTOCLAIM` for crashed-worker recovery

**Phase 3 — Resilience**
- [ ] Circuit breaker: open / half-open probe / close + drain with rate limit
- [ ] Per-endpoint concurrency limits
- [ ] Endpoint-owner failure notifications (Resend)
- [ ] Replay: single + bulk-by-time-window

**Phase 4 — Surface**
- [ ] Dashboard: messages, attempt timeline, endpoint health, live tail
- [ ] Test-event sender
- [ ] `@relay/node` SDK — send + **verify** — published to npm
- [ ] Docs site: quickstart, signing/verification guide, retry schedule table, idempotency guide

**Phase 5 — Proof**
- [ ] A deliberately flaky receiver in `examples/` (returns 500 30% of the time, 200 otherwise) → demo the retries visibly recovering
- [ ] Test suite: retry schedule correctness, jitter bounds, signature verification, idempotent ingest, circuit transitions
- [ ] Load test the ingest path; record throughput + p99 in the README
- [ ] README with an architecture diagram and an honest "at-least-once, here's why" section

## What Patrick needs to provide

- Railway (or Fly) account — needs **two** services: API and worker
- Redis + Postgres instances
- npm account for `@relay/node`
- Resend key for endpoint-failure notifications
- A decision on the name — "Relay" is generic and there are existing products with it; **`Dispatch`, `Hookline`, or `Anvil`** are cleaner and more searchable. Worth changing before the repo is public.
