---
name: ledger-core
description: Full context for `packages/ledger` — the shared double-entry accounting engine used by the payroll, cooperative, and hotel applications. Immutable journal entries, integer minor units, balanced-or-abort, append-only with reversals instead of edits. Use this skill whenever working on anything that moves money in any of these apps — posting transactions, designing a chart of accounts, computing balances or a trial balance, handling reversals or corrections, currency and rounding, or reconciliation. Trigger this even when the user doesn't say "ledger" explicitly — any mention of double-entry, journal entries, debits and credits, account balances, trial balance, folio postings, loan interest accrual, or money representation qualifies. Read this before writing any code that touches a monetary amount.
---

# `packages/ledger` — Double-Entry Accounting Engine

**Why this is a package and not a table in each app:** payroll posts salary expense and statutory liabilities. The cooperative posts member savings, loan disbursements, interest, and dividends. The hotel posts room charges, taxes, and payments to guest folios. These are the same operation. Writing it three times means getting it wrong three times.

**Why it's the most valuable thing in the portfolio:** anyone can build CRUD. A correct ledger — one where money cannot vanish, where every historical figure is reproducible, where corrections leave a trail — is the thing that separates people who have shipped financial software from people who haven't. Reviewers who have done it will read this package first.

---

## The four invariants

Everything else is detail. These are the product.

### 1. Money is an integer in minor units

```ts
type Money = {
  amount: bigint;              // minor units: kobo, fils, cents
  currency: CurrencyCode;
};
```

`0.1 + 0.2 !== 0.3`. A float in a money column is not a rounding quirk — it is money silently disappearing, and it will be discovered by an accountant, not by you.

**Minor unit exponents are not all 2.**

| Currency | Exponent | 1 unit = |
|---|---|---|
| NGN | 2 | 100 kobo |
| USD / GBP / EUR | 2 | 100 cents |
| **KWD** | **3** | **1000 fils** |
| **BHD, OMR** | **3** | 1000 |
| JPY | 0 | 1 |

Hardcoding `× 100` will corrupt every Kuwaiti amount by a factor of ten. Store the exponent per currency and look it up.

### 2. Every transaction balances, or it does not exist

```
sum(debits) - sum(credits) === 0
```

Checked **inside the transaction**, before commit. An unbalanced entry does not get written and logged as a warning — it aborts. Enforce it in the database too, with a deferred constraint or a trigger, so that no future code path can bypass the application layer.

### 3. Append-only. Corrections are reversals.

No `UPDATE`. No `DELETE`. Ever.

A mistake is fixed by posting a **reversing entry** (same lines, opposite signs) and then the correct entry. The wrong number stays visible in the history, flagged, with a link to what replaced it. This is not bureaucratic caution — it is the only way an auditor (or you, in eight months) can answer "what did we think was true on 3 March, and when did we find out otherwise?"

### 4. Idempotency on every post

Every transaction carries an `idempotency_key` with a unique constraint. Payroll runs get retried. Night audit gets run twice by a nervous night manager. Webhook handlers redeliver. Posting the same transaction twice must be a no-op, not a double-charge.

---

## Data model

```sql
-- Accounts form a tree. Leaf accounts hold postings; parents aggregate.
create table accounts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  code       text not null,                  -- '1000', '2100.PAYE'
  name       text not null,
  type       account_type not null,          -- asset|liability|equity|revenue|expense
  parent_id  uuid references accounts(id),
  currency   text not null,
  is_leaf    boolean not null default true,
  unique (org_id, code)
);

-- A journal entry is one balanced financial event.
create table journal_entries (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  entry_date      date not null,             -- the accounting date, NOT created_at
  description     text not null,
  source          text not null,             -- 'payroll' | 'coop.loan' | 'hotel.folio'
  source_id       text,                      -- the run/loan/folio it came from
  idempotency_key text not null,
  reverses_id     uuid references journal_entries(id),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  unique (org_id, idempotency_key)
);

create table journal_lines (
  id         bigserial primary key,
  entry_id   uuid not null references journal_entries(id) on delete restrict,
  account_id uuid not null references accounts(id),
  -- Signed. Debits positive, credits negative. One column, not two: a single
  -- `sum(amount) = 0` check then proves the entry balances, and it is impossible
  -- to write a line that is somehow both.
  amount     bigint not null,
  currency   text not null,
  memo       text
);
create index on journal_lines (account_id);
create index on journal_lines (entry_id);
```

**`entry_date` is not `created_at`.** A payroll run for March, approved on 3 April, has `entry_date = 2026-03-31`. Reports are built on `entry_date`. Confusing the two produces figures that shift depending on when you ran the report, which is the sort of thing that ends a client relationship.

### Balance enforcement

```sql
create or replace function assert_entry_balances() returns trigger
language plpgsql as $$
begin
  if (select sum(amount) from journal_lines where entry_id = new.entry_id) <> 0 then
    raise exception 'journal entry % does not balance', new.entry_id;
  end if;
  return null;
end;
$$;

create constraint trigger je_balances
  after insert on journal_lines
  deferrable initially deferred          -- fires at COMMIT, once all lines are in
  for each row execute function assert_entry_balances();
```

The `deferrable initially deferred` is the whole trick — lines are inserted one at a time, so the check must run at commit, not per row.

---

## API

```ts
await ledger.post({
  orgId,
  entryDate: "2026-03-31",
  description: "Payroll March 2026",
  source: "payroll",
  sourceId: runId,
  idempotencyKey: `payroll:${runId}`,
  lines: [
    { account: "6000", amount:  5_000_00n },  // Dr Salary Expense
    { account: "2100", amount:   -750_00n },  // Cr PAYE Payable
    { account: "2200", amount:   -400_00n },  // Cr Pension Payable
    { account: "2900", amount: -3_850_00n },  // Cr Net Pay Payable
  ],
});
// throws if sum !== 0; returns the existing entry if the key was seen before
```

```ts
await ledger.balance(accountCode, { asOf: "2026-03-31" });
await ledger.trialBalance({ asOf });          // must sum to zero. always.
await ledger.reverse(entryId, { reason });    // posts the mirror, links both
```

Balances are **derived** by summing lines, never stored in a mutable column. If performance demands it later, add a materialized snapshot table with a rebuild-from-journal command — but the journal stays the source of truth. A cached balance that drifts from its journal is worse than a slow query.

---

## Charts of accounts per app

Each vertical ships a seed chart. Keep the numbering conventional so an accountant can read it without a manual:

- `1xxx` Assets · `2xxx` Liabilities · `3xxx` Equity · `4xxx` Revenue · `6xxx` Expenses

**Payroll:** `6000` Salary Expense · `2100` PAYE Payable · `2200` Pension Payable · `2300` NHF Payable · `2400` End-of-Service Provision · `2900` Net Pay Payable

**Cooperative:** `1100` Loans Receivable · `2100` Member Savings · `3100` Share Capital · `4100` Interest Income · `6100` Dividends

**Hotel:** `1200` Guest Folios (AR) · `4000` Room Revenue · `4100` F&B Revenue · `2500` Tax Payable · `2600` Deposits Held

---

## The artifacts that prove it

- **Property test:** for any random sequence of valid postings, `trialBalance()` sums to exactly `0n`. Run it a thousand times with generated data.
- **Property test:** `balance(account) === sum(lines for account)` — no drift, ever.
- **Idempotency test:** post the same key twice; assert one entry exists and balances are unchanged.
- **Reversal test:** post, reverse, assert net balance is zero and *both* entries are still visible.
- **Currency test:** a KWD amount round-trips through the whole system without losing the third decimal.

Put the property tests in the README. "The trial balance sums to zero under a thousand randomized transaction sequences" is a sentence that gets you taken seriously.

---

## Build state

- [x] Package scaffold, `Money` type with per-currency exponents — `packages/ledger/src/money.ts`
- [x] Schema: accounts, journal_entries, journal_lines + deferred balance trigger — `packages/ledger/migrations/0001_ledger.sql`
- [x] `post()` with idempotency — `packages/ledger/src/ledger.ts`
- [x] `balance()`, `trialBalance()`
- [x] `reverse()`
- [x] Chart-of-accounts seeds for payroll, coop, hotel — `packages/ledger/src/chartsOfAccounts.ts`
- [x] Property tests (balance, drift, idempotency, reversal, KWD precision) — `packages/ledger/tests/ledger.spec.ts`, all green
- [x] README with the four invariants stated plainly — `packages/ledger/README.md`

Not yet built: `allocate()` (largest-remainder dividend/interest splitting, mentioned in the
root README) belongs to `apps/coop` when that's built, not to this package.

## Never

- ❌ Store money as `float`, `real`, `double`, or JS `number`
- ❌ `UPDATE` or `DELETE` a journal line
- ❌ Write an unbalanced entry "to fix later"
- ❌ Cache a balance without a rebuild path
- ❌ Assume two decimal places
