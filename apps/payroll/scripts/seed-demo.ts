import { withUserContext } from "@bp/core";
import { seedChartOfAccounts } from "@bp/ledger";
import pg from "pg";
import { addEmploymentRecord, createEmployee } from "../src/employees.js";
import { approveAndPostRun, calculateRun, createPayrollRun } from "../src/payrollRun.js";
import { DEMO_ADMIN_ID, DEMO_OWNER_ID, DEMO_VIEWER_ID } from "../src/demoPersonas.js";

const { Client } = pg;

interface DemoEmployeeSeed {
  fullName: string;
  basicNaira: number;
  pensionOptIn: boolean;
  nhfOptIn: boolean;
  rentNaira: number;
  loginPersonaId?: string;
  loginRole?: "owner" | "admin" | "viewer";
}

// A spread of salaries crossing every PAYE band, and a mix of opt-ins, so
// the demo run exercises the same variety as tests/payrollRun.spec.ts. The
// first three double as the demo login personas.
const EMPLOYEES: DemoEmployeeSeed[] = [
  { fullName: "Adaeze Okafor", basicNaira: 850_000, pensionOptIn: true, nhfOptIn: true, rentNaira: 3_000_000, loginPersonaId: DEMO_OWNER_ID, loginRole: "owner" },
  { fullName: "Tunde Bakare", basicNaira: 500_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 0, loginPersonaId: DEMO_ADMIN_ID, loginRole: "admin" },
  { fullName: "Ngozi Chukwu", basicNaira: 220_000, pensionOptIn: true, nhfOptIn: true, rentNaira: 900_000, loginPersonaId: DEMO_VIEWER_ID, loginRole: "viewer" },
  { fullName: "Emeka Nwosu", basicNaira: 150_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 0 },
  { fullName: "Folake Adeyemi", basicNaira: 180_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 600_000 },
  { fullName: "Ibrahim Sule", basicNaira: 95_000, pensionOptIn: false, nhfOptIn: false, rentNaira: 0 },
  { fullName: "Chiamaka Eze", basicNaira: 310_000, pensionOptIn: true, nhfOptIn: true, rentNaira: 0 },
  { fullName: "Segun Adebayo", basicNaira: 260_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 0 },
  { fullName: "Amaka Obi", basicNaira: 130_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 0 },
  { fullName: "Yusuf Aliyu", basicNaira: 175_000, pensionOptIn: false, nhfOptIn: false, rentNaira: 0 },
  { fullName: "Chinwe Okonkwo", basicNaira: 400_000, pensionOptIn: true, nhfOptIn: true, rentNaira: 1_500_000 },
  { fullName: "Bolaji Ogundimu", basicNaira: 210_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 0 },
  { fullName: "Halima Bello", basicNaira: 145_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 0 },
  { fullName: "Chukwudi Umeh", basicNaira: 1_200_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 4_000_000 },
  { fullName: "Titilayo Fashola", basicNaira: 165_000, pensionOptIn: true, nhfOptIn: true, rentNaira: 0 },
  { fullName: "Musa Garba", basicNaira: 120_000, pensionOptIn: false, nhfOptIn: false, rentNaira: 0 },
  { fullName: "Ifeoma Nnamdi", basicNaira: 285_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 0 },
  { fullName: "Wale Ojo", basicNaira: 190_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 700_000 },
  { fullName: "Grace Etim", basicNaira: 155_000, pensionOptIn: true, nhfOptIn: true, rentNaira: 0 },
  { fullName: "Abdullahi Yakubu", basicNaira: 350_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 0 },
  { fullName: "Chidinma Igwe", basicNaira: 105_000, pensionOptIn: true, nhfOptIn: false, rentNaira: 0 },
  { fullName: "Femi Alabi", basicNaira: 480_000, pensionOptIn: true, nhfOptIn: true, rentNaira: 2_000_000 },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_payroll_demo";
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();

  try {
    const orgResult = await admin.query<{ id: string }>(
      "insert into organizations (name, slug) values ('Wagebook Demo', 'wagebook-demo') returning id",
    );
    const orgId = orgResult.rows[0]!.id;
    console.log(`org: ${orgId}`);

    for (const employee of EMPLOYEES) {
      if (employee.loginPersonaId) {
        await admin.query("insert into memberships (org_id, user_id, role) values ($1, $2, $3)", [
          orgId,
          employee.loginPersonaId,
          employee.loginRole,
        ]);
      }
    }

    await withUserContext(DEMO_OWNER_ID, (client) => seedChartOfAccounts(client, orgId, "payroll", "NGN"));
    console.log("chart of accounts seeded");

    await withUserContext(DEMO_OWNER_ID, async (client) => {
      let staffNumber = 1;
      for (const seed of EMPLOYEES) {
        const employee = await createEmployee(client, {
          orgId,
          staffNumber: `WB-${String(staffNumber++).padStart(3, "0")}`,
          fullName: seed.fullName,
          nationality: "NG",
          hireDate: "2025-01-01",
          pensionOptIn: seed.pensionOptIn,
          nhfOptIn: seed.nhfOptIn,
        });

        const basic = BigInt(seed.basicNaira) * 100n;
        await addEmploymentRecord(client, orgId, employee.id, {
          effectiveFrom: "2025-01-01",
          basic,
          housing: basic / 3n,
          transport: basic / 6n,
          annualRent: BigInt(seed.rentNaira) * 100n,
          currency: "NGN",
        });
      }
    });
    console.log(`${EMPLOYEES.length} employees seeded`);

    const run = await withUserContext(DEMO_OWNER_ID, (client) => createPayrollRun(client, orgId, "2026-03", "NG"));
    await withUserContext(DEMO_OWNER_ID, (client) => calculateRun(client, orgId, run.id));
    const posted = await withUserContext(DEMO_OWNER_ID, (client) => approveAndPostRun(client, orgId, run.id, DEMO_OWNER_ID));
    console.log(`payroll run ${posted.id} posted, journal entry ${posted.journalEntryId}`);
  } finally {
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
