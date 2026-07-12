---
name: ajo-cooperative
description: Full project context for Ajo — a multipurpose cooperative society platform (thrift savings, loans against savings, share capital, year-end dividends) built on the shared multi-tenant core and double-entry ledger. Use this skill whenever working on Ajo in any way — member records, monthly contributions, loan applications and approvals, amortization schedules, interest accrual, guarantors, dividend allocation, defaults and rescheduling, or the member portal. Trigger this even when the user doesn't say "Ajo" explicitly — any mention of the cooperative project, thrift or esusu or ajo savings, loans against savings, share capital, dividend allocation, or Member/Contribution/Loan/Repayment entities qualifies. Read this before generating any Ajo code, and update the Build State checklist at the end of every session.
---

# Ajo — Cooperative Society Platform

> Name is a placeholder — "Ajo" (Yoruba, rotating savings) is memorable and market-appropriate, but check availability.

**Commercial thesis:** thousands of registered multipurpose cooperative societies across Nigeria run on Excel spreadsheets, paper ledgers, and WhatsApp. They handle real money — member savings, loans, dividends — with no audit trail. This is the most directly sellable thing on the list.

**Portfolio thesis:** it is a loan book. Interest accrual, amortization, and dividend allocation on a double-entry ledger where every kobo must reconcile. If the ledger is right, this project is proof you can be trusted with money.

**One-liner:** *Savings, loans, and dividends for cooperative societies — every transaction posted to an immutable double-entry ledger, with amortization schedules, guarantor tracking, and a year-end dividend allocation that reconciles to the last kobo.*

---

## Stack

Next.js 15 · TypeScript strict · Tailwind · shadcn/ui · Postgres
Built on **`packages/core`** (tenancy, RBAC, RLS, audit) and **`packages/ledger`** (double-entry).
Read `ledger-core` SKILL.md before writing a single line that touches money.

---

## Domain model

```
Society (org) ──< Member ──< Contribution        (monthly savings)
                    │
                    ├──< ShareCapital            (equity stake)
                    │
                    ├──< Loan ──< RepaymentSchedule
                    │      │        └──< Repayment
                    │      └──< Guarantor >── Member
                    │
                    └──< DividendAllocation
```

- `members` — org_id, membership_number, name, join_date, status (`active`|`dormant`|`exited`), bank details, next of kin
- `contributions` — member_id, period (year, month), amount (bigint minor units), posted_at, journal_entry_id
- `share_capital` — member_id, units, amount, acquired_at
- `loans` — member_id, principal, interest_rate, tenor_months, method (`flat`|`reducing_balance`), status (`pending`|`approved`|`disbursed`|`active`|`repaid`|`defaulted`|`rescheduled`), disbursed_at
- `repayment_schedules` — loan_id, installment_no, due_date, principal_due, interest_due, **generated at disbursement, never recomputed**
- `repayments` — loan_id, schedule_id, amount, paid_at, journal_entry_id
- `guarantors` — loan_id, member_id, amount_guaranteed
- `dividend_runs` — org_id, financial_year, distributable_surplus, status
- `dividend_allocations` — run_id, member_id, basis_amount, allocated

---

## The rules that make it a real system

### Loan eligibility is a hard constraint, not a suggestion

The classic cooperative rule: **a member may borrow up to N× their accumulated savings** (commonly 2× or 3×), subject to guarantors covering the exposure. Enforce it in the database and in the approval workflow. A cooperative that lends beyond savings without guarantor cover is one default away from collapse — and this rule is precisely what the members' AGM will ask you about.

Guarantor exposure must also be tracked: **a member's own savings are encumbered by every loan they guarantee.** So the eligibility check is:

```
available_to_borrow = (savings × multiplier) - outstanding_loans - guaranteed_exposure
```

Getting this right is the domain insight that shows you actually understand cooperatives rather than having built a generic loan CRUD.

### Amortization: flat vs reducing balance

Nigerian cooperatives use both, and they produce very different numbers. **Ask which; do not assume.**

- **Flat rate:** interest = `principal × rate × years`, split evenly across installments. Simple, and quietly expensive for the borrower.
- **Reducing balance:** interest each period is charged on the *outstanding* principal. Standard amortization.

Generate the full schedule **at disbursement** and store it. Do not recompute it on read — if the rate or tenor is later edited, historical installments must not silently change. Schedules are immutable; a reschedule creates a *new* schedule and closes the old one.

Rounding: the final installment absorbs the residual so that `sum(principal_due) === principal` exactly. Never leave a stray kobo.

### Dividend allocation must reconcile exactly

At year end, distributable surplus is allocated to members, typically pro-rata on savings, share capital, or patronage.

```
allocation_i = floor(surplus × basis_i / total_basis)
```

Floor every allocation, then **distribute the remainder** (which will be a few kobo) by a deterministic rule — largest-remainder method, or to the highest-basis members. `sum(allocations)` must equal `surplus` **exactly**. Not approximately. A dividend run that loses ₦3 to rounding across 400 members is a run that gets rejected at the AGM.

This is a genuinely nice piece of code and worth a section in the README.

---

## Ledger postings

Every financial event goes through `packages/ledger`. No exceptions, no direct balance updates.

| Event | Debit | Credit |
|---|---|---|
| Member contribution | `1000` Bank | `2100` Member Savings |
| Loan disbursement | `1100` Loans Receivable | `1000` Bank |
| Repayment (principal) | `1000` Bank | `1100` Loans Receivable |
| Repayment (interest) | `1000` Bank | `4100` Interest Income |
| Interest accrual | `1150` Interest Receivable | `4100` Interest Income |
| Dividend declared | `6100` Dividends | `2150` Dividends Payable |
| Dividend paid | `2150` Dividends Payable | `1000` Bank |
| Loan write-off | `6200` Bad Debt | `1100` Loans Receivable |

A member's savings balance is **derived from the ledger**, never stored in a column on `members`. The moment you cache it, it drifts, and a member will find the discrepancy before you do.

---

## Screens

```
/[society]/members                    roster, savings balance, loan exposure
/[society]/members/[id]               statement — every transaction, ledger-backed
/[society]/contributions              monthly posting run, bulk import from bank statement
/[society]/loans                      pipeline: pending → approved → disbursed → active
/[society]/loans/[id]                 schedule, repayments, guarantors, arrears
/[society]/loans/new                  eligibility check runs live as you type the amount
/[society]/dividends                  year-end run: surplus → allocation → approve → post
/[society]/reports                    trial balance, loan book ageing, arrears report
/portal                               member self-service: my savings, my loans, my statement
```

**The member statement is the product.** A cooperative member's core anxiety is "where is my money and is it right?" A clean, printable, ledger-backed statement that reconciles to the kobo answers it — and it is what will actually sell this to a society's treasurer.

**Arrears ageing** (30/60/90+ days) is the second thing any treasurer asks for.

---

## Build state

**Phase 1 — Members & savings**
- [ ] Built on `packages/core` (tenancy, RBAC, audit) — do not rebuild it
- [ ] Members, share capital, membership lifecycle
- [ ] Contributions with ledger posting
- [ ] Member statement, derived entirely from the ledger

**Phase 2 — Loans**
- [ ] Loan application + eligibility engine (savings × multiplier − outstanding − guaranteed)
- [ ] Guarantors, with encumbrance tracked against the guarantor's own savings
- [ ] Approval workflow (RBAC: treasurer/committee)
- [ ] Amortization: flat **and** reducing balance; schedule generated at disbursement, immutable
- [ ] Disbursement → ledger
- [ ] Repayments, split principal/interest, → ledger
- [ ] Arrears ageing report

**Phase 3 — Year end**
- [ ] Interest accrual run
- [ ] Dividend run: surplus → pro-rata allocation → largest-remainder distribution
- [ ] Assert `sum(allocations) === surplus` exactly, in a test
- [ ] Trial balance report

**Phase 4 — Members & proof**
- [ ] Member self-service portal
- [ ] Loan write-off / rescheduling (new schedule, old one closed, both visible)
- [ ] Bulk import from bank statement (CSV) with matching
- [ ] Property tests: no loan exceeds eligibility; ledger balances; dividends reconcile
- [ ] Seed a demo society: 60 members, 3 years of contributions, a live loan book with arrears
- [ ] Deploy with demo login

## What Patrick needs to provide

- **Which amortization method** the target societies actually use — flat or reducing balance (often flat, in practice)
- The **savings multiplier** convention (2× or 3×)
- The dividend basis: savings, share capital, or patronage
- Ideally: **a real cooperative's treasurer for thirty minutes.** The domain rules above are the common pattern, but every society has its own bylaws, and the ones you'd sell to will tell you exactly what they need. That conversation is worth more than a month of guessing.
