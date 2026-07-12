# Six days

Today is Sunday. Deadline is next weekend.

**You cannot build four apps. You can build one, properly, on a real foundation — and that
is worth far more than four broken ones, especially if someone is going to look at it.**

## The plan

| Day | Do this | Done when |
|---|---|---|
| **Sun (today)** | `pnpm install`. Run the ledger tests. Provision the VPS. | `pnpm --filter @bp/ledger test` green; you can SSH in |
| **Mon** | `core`: migrations, RLS, `assertRole`, audit. **Write the cross-tenant RLS test.** | Org A provably cannot read Org B |
| **Tue** | `ledger`: wire to Postgres, chart of accounts, post/balance/reverse | Trial balance sums to zero under randomised postings |
| **Wed** | `payroll`: rules engine + NG jurisdiction pack. **Golden tests first, UI second.** | A payslip computes correctly against real tax tables |
| **Thu** | `payroll`: employees, a payroll run, payslip PDF, ledger posting | You can run March 2026 payroll for 20 employees |
| **Fri** | Deploy. Seed demo data. Demo login. Fix the demo. | The URL works from a phone on mobile data |
| **Sat** | README, architecture diagram, record a 2-min walkthrough | Someone else can understand it in 90 seconds |

## What you are cutting

Kuwait jurisdiction, leave, self-service portal, coop, hotel, school, AI.
They're specced. They're not this week.

## The three things that must be true by Friday

1. **The demo URL loads and works.** A dead link is worse than no link.
2. **The RLS test is green and visible in the README.** That's the artifact.
3. **A payslip is arithmetically correct** against published tax tables, with the source cited.

Everything else is decoration.

## If you slip

Cut the payslip PDF before you cut the golden tests. Cut the UI polish before you cut the
RLS test. Ship *correct and ugly* over *pretty and wrong* — the second one gets found in
the interview.
