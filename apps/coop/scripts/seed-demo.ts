import { withUserContext } from "@bp/core";
import { seedChartOfAccounts } from "@bp/ledger";
import pg from "pg";
import { DEMO_ADMIN_ID, DEMO_OWNER_ID, DEMO_VIEWER_ID } from "../src/demoPersonas.js";
import { createMember } from "../src/members.js";
import { postContribution } from "../src/contributions.js";
import { applyForLoan, approveLoan, disburseLoan, postRepayment } from "../src/loans.js";
import { runInterestAccrual } from "../src/interestAccrual.js";
import { allocateDividends, approveDividendRun, createDividendRun, postDividendRun } from "../src/dividends.js";

const { Client } = pg;

interface DemoMemberSeed {
  fullName: string;
  monthlyNaira: number;
  monthsContributed: number; // how many consecutive months, ending at the seed month below
  loginPersonaId?: string;
  loginRole?: "owner" | "admin" | "viewer";
}

const SEED_YEAR = 2026;
const SEED_MONTH = 6; // seed contributions ending in June 2026

// A spread of contribution histories — some members joined a year ago and
// have been paying every month, some joined recently. The first three
// double as the demo login personas.
const MEMBERS: DemoMemberSeed[] = [
  { fullName: "Chief Adebayo Fashina", monthlyNaira: 20_000, monthsContributed: 12, loginPersonaId: DEMO_OWNER_ID, loginRole: "owner" },
  { fullName: "Mrs. Uche Anyanwu", monthlyNaira: 15_000, monthsContributed: 12, loginPersonaId: DEMO_ADMIN_ID, loginRole: "admin" },
  { fullName: "Mr. Godwin Etuk", monthlyNaira: 10_000, monthsContributed: 8, loginPersonaId: DEMO_VIEWER_ID, loginRole: "viewer" },
  { fullName: "Blessing Okoye", monthlyNaira: 12_000, monthsContributed: 12 },
  { fullName: "Emeka Nwachukwu", monthlyNaira: 25_000, monthsContributed: 10 },
  { fullName: "Fatima Suleiman", monthlyNaira: 8_000, monthsContributed: 6 },
  { fullName: "Tobenna Uzo", monthlyNaira: 18_000, monthsContributed: 12 },
  { fullName: "Aisha Bello", monthlyNaira: 10_000, monthsContributed: 4 },
  { fullName: "Chukwuemeka Ike", monthlyNaira: 15_000, monthsContributed: 9 },
  { fullName: "Ronke Adeleke", monthlyNaira: 22_000, monthsContributed: 12 },
  { fullName: "Yakubu Danladi", monthlyNaira: 9_000, monthsContributed: 5 },
  { fullName: "Ngozi Umeh", monthlyNaira: 30_000, monthsContributed: 12 },
  { fullName: "Segun Ayodele", monthlyNaira: 11_000, monthsContributed: 7 },
  { fullName: "Amara Chukwu", monthlyNaira: 14_000, monthsContributed: 12 },
  { fullName: "Ibrahim Musa", monthlyNaira: 10_000, monthsContributed: 3 },
];

function monthsBackFrom(year: number, month: number, count: number): Array<{ year: number; month: number }> {
  const periods: Array<{ year: number; month: number }> = [];
  let y = year;
  let m = month;
  for (let i = 0; i < count; i++) {
    periods.push({ year: y, month: m });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return periods.reverse();
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_coop_demo";
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();

  try {
    const orgResult = await admin.query<{ id: string }>(
      "insert into organizations (name, slug) values ('Ajo Demo Cooperative', 'ajo-demo') returning id",
    );
    const orgId = orgResult.rows[0]!.id;
    console.log(`org: ${orgId}`);

    for (const member of MEMBERS) {
      if (member.loginPersonaId) {
        await admin.query("insert into memberships (org_id, user_id, role) values ($1, $2, $3)", [
          orgId,
          member.loginPersonaId,
          member.loginRole,
        ]);
      }
    }

    await withUserContext(DEMO_OWNER_ID, (client) => seedChartOfAccounts(client, orgId, "coop", "NGN"));
    console.log("chart of accounts seeded");

    let memberNumber = 1;
    const membersByName = new Map<string, { id: string }>();
    for (const seed of MEMBERS) {
      const membershipNumber = `AJO-${String(memberNumber++).padStart(3, "0")}`;
      const joinDate = monthsBackFrom(SEED_YEAR, SEED_MONTH, seed.monthsContributed)[0];
      const member = await withUserContext(DEMO_OWNER_ID, (client) =>
        createMember(client, {
          orgId,
          membershipNumber,
          fullName: seed.fullName,
          joinDate: `${joinDate!.year}-${String(joinDate!.month).padStart(2, "0")}-01`,
        }),
      );
      membersByName.set(seed.fullName, member);

      const amount = BigInt(seed.monthlyNaira) * 100n;
      for (const period of monthsBackFrom(SEED_YEAR, SEED_MONTH, seed.monthsContributed)) {
        await withUserContext(DEMO_OWNER_ID, (client) =>
          postContribution(client, {
            orgId,
            memberId: member.id,
            periodYear: period.year,
            periodMonth: period.month,
            amount,
          }),
        );
      }
    }
    console.log(`${MEMBERS.length} members seeded, with contribution histories`);

    // A handful of loans in different pipeline states, so the loans UI has
    // something to show: one still awaiting approval, one active with an
    // overdue installment (to populate the arrears report), and one fully
    // repaid (flat-rate and reducing-balance, one of each).
    const pendingBorrower = membersByName.get("Aisha Bello")!;
    await withUserContext(DEMO_OWNER_ID, (client) =>
      applyForLoan(client, {
        orgId,
        memberId: pendingBorrower.id,
        principal: 30_000_00n,
        interestRate: 0.15,
        tenorMonths: 6,
        method: "flat",
      }),
    );

    const arrearsBorrower = membersByName.get("Blessing Okoye")!;
    const arrearsLoan = await withUserContext(DEMO_OWNER_ID, (client) =>
      applyForLoan(client, {
        orgId,
        memberId: arrearsBorrower.id,
        principal: 60_000_00n,
        interestRate: 0.14,
        tenorMonths: 6,
        method: "flat",
      }),
    );
    await withUserContext(DEMO_OWNER_ID, (client) => approveLoan(client, arrearsLoan.id, DEMO_OWNER_ID));
    await withUserContext(DEMO_OWNER_ID, (client) => disburseLoan(client, arrearsLoan.id));
    await admin.query(
      `update repayment_schedules set due_date = current_date - interval '45 days'
       where loan_id = $1 and installment_no = 1`,
      [arrearsLoan.id],
    );

    const repaidBorrower = membersByName.get("Tobenna Uzo")!;
    const repaidLoan = await withUserContext(DEMO_OWNER_ID, (client) =>
      applyForLoan(client, {
        orgId,
        memberId: repaidBorrower.id,
        principal: 90_000_00n,
        interestRate: 0.13,
        tenorMonths: 6,
        method: "reducing_balance",
      }),
    );
    await withUserContext(DEMO_OWNER_ID, (client) => approveLoan(client, repaidLoan.id, DEMO_OWNER_ID));
    await withUserContext(DEMO_OWNER_ID, (client) => disburseLoan(client, repaidLoan.id));
    for (let i = 0; i < 6; i++) {
      await withUserContext(DEMO_OWNER_ID, (client) => postRepayment(client, { loanId: repaidLoan.id }));
    }
    console.log("3 demo loans seeded: pending, active with arrears, fully repaid");

    // An interest accrual run against the overdue installment above, and a
    // full dividend run (create -> allocate -> approve -> post), so /reports
    // has real data to show instead of empty tables.
    const asOfDate = new Date().toISOString().slice(0, 10);
    await withUserContext(DEMO_OWNER_ID, (client) => runInterestAccrual(client, orgId, asOfDate));
    console.log("interest accrual run seeded");

    const dividendRun = await withUserContext(DEMO_OWNER_ID, (client) =>
      createDividendRun(client, {
        orgId,
        financialYear: SEED_YEAR - 1,
        distributableSurplus: 500_000_00n,
        basis: "savings",
      }),
    );
    await withUserContext(DEMO_OWNER_ID, (client) => allocateDividends(client, dividendRun.id));
    await withUserContext(DEMO_OWNER_ID, (client) => approveDividendRun(client, dividendRun.id, DEMO_OWNER_ID));
    await withUserContext(DEMO_OWNER_ID, (client) => postDividendRun(client, dividendRun.id));
    console.log(`dividend run seeded for FY${SEED_YEAR - 1}`);

    console.log("done");
    console.log(`login as: owner=${DEMO_OWNER_ID} admin=${DEMO_ADMIN_ID} viewer=${DEMO_VIEWER_ID}`);
  } finally {
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
