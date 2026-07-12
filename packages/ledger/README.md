# `packages/ledger`

The shared double-entry accounting engine used by payroll, the cooperative, and the hotel
app. Integer minor-unit money, balanced-or-abort, append-only with reversals instead of
edits.

**Status:** built and tested — `post()`, `balance()`, `trialBalance()`, `reverse()`, chart-of-
accounts seeds for payroll/coop/hotel, and the property tests below. `pnpm --filter
@bp/ledger test` is green.

## The four invariants

1. **Money is an integer in minor units** (`bigint`), with the exponent looked up per
   currency — not every currency has two decimals (`1 KWD = 1000 fils`).
2. **Every transaction balances, or it does not exist.** Checked in the application
   (`UnbalancedEntryError`) *and* by a deferred constraint trigger in Postgres that fires at
   commit — `tests/ledger.spec.ts` proves the trigger catches what the application check is
   bypassed for.
3. **Append-only.** No `UPDATE`, no `DELETE` — there is no RLS policy or grant that permits
   either on `journal_entries`/`journal_lines`. Corrections are reversing entries via
   `reverse()`.
4. **Idempotency on every post.** `idempotencyKey` is unique per org; posting or reversing the
   same key twice is a no-op, proven in tests.

## The proof

`tests/ledger.spec.ts` — 8 tests, all green:

- posts a balanced entry; rejects an unbalanced one at the application layer
- **the database also rejects an unbalanced entry**, bypassing the application check entirely,
  proving the deferred trigger is the real backstop
- idempotent posting and idempotent reversal
- `reverse()` — both entries stay visible, net balance returns to its prior value
- a KWD amount round-trips through `post()`/`balance()` without losing the third decimal
- **property test:** under 100 rounds of randomized balanced postings, `trialBalance()` sums
  to exactly `0n`, and every account's `balance()` matches an independent raw-SQL aggregate
  (no drift)

## Running it

```bash
docker compose up -d postgres     # from the repo root
pnpm --filter @bp/ledger exec tsx scripts/create-db.ts   # DATABASE_URL defaults to bp_ledger
pnpm --filter @bp/ledger run migrate    # applies packages/core's migrations first, then ledger's
pnpm --filter @bp/ledger test
```

Journal entries are org-scoped through the same `has_org_role()`/RLS mechanism as
`packages/core` — this package's migration depends on core's `organizations`/`memberships`
tables existing in the same database, matching how apps actually deploy (see the root
README: "one database per app," core + ledger + the app's own schema, combined).

## Not built yet

`allocate()` — largest-remainder-method splitting for dividends/interest across many
members — belongs to `apps/coop`, not here.

## Project context for AI assistants

Full spec — the four invariants, schema, API, and Build State checklist:

```
.claude/skills/ledger-core/SKILL.md
```

Read it before writing any code that touches a monetary amount; update its Build State
checklist when a phase lands.
