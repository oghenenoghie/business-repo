import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../lib/session";
import { getDemoOrg } from "../../lib/org";
import { Nav } from "../nav";

function formatNaira(minorUnits: string | number): string {
  const value = typeof minorUnits === "string" ? BigInt(minorUnits) : BigInt(minorUnits);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}₦${(abs / 100n).toLocaleString("en-NG")}`;
}

export default async function DashboardPage() {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const data = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);

    const employeeCount = await client.query<{ count: string }>("select count(*) from employees where org_id = $1", [org.id]);

    const latestRun = await client.query<{
      id: string;
      period: string;
      status: string;
      journal_entry_id: string | null;
    }>("select id, period, status, journal_entry_id from payroll_runs where org_id = $1 order by period desc limit 1", [org.id]);

    const totals = latestRun.rows[0]
      ? await client.query<{ gross: string; deductions: string; net: string; payslips: string }>(
          `select coalesce(sum(gross), 0) as gross, coalesce(sum(total_deductions), 0) as deductions,
                  coalesce(sum(net), 0) as net, count(*) as payslips
           from payslips where run_id = $1`,
          [latestRun.rows[0].id],
        )
      : null;

    const trialBalance = latestRun.rows[0]?.journal_entry_id
      ? await client.query<{ total: string }>(
          `select coalesce(sum(jl.amount), 0) as total
           from journal_lines jl join accounts a on a.id = jl.account_id
           where a.org_id = $1`,
          [org.id],
        )
      : null;

    return { org, employeeCount: employeeCount.rows[0]!.count, run: latestRun.rows[0] ?? null, totals: totals?.rows[0] ?? null, trialBalance: trialBalance?.rows[0]?.total ?? null };
  });

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>{data.org.name}</h1>
        <p style={{ color: "var(--muted)", marginBottom: "2rem" }}>{data.employeeCount} employees</p>

        {data.run && data.totals ? (
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.1rem" }}>Payroll run — {data.run.period}</h2>
              <span
                style={{
                  fontSize: "0.75rem",
                  textTransform: "uppercase",
                  padding: "0.2rem 0.6rem",
                  borderRadius: 999,
                  background: data.run.status === "posted" ? "rgba(47,191,113,0.15)" : "rgba(224,165,38,0.15)",
                  color: data.run.status === "posted" ? "var(--positive)" : "var(--warning)",
                }}
              >
                {data.run.status}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
              <Stat label="Payslips" value={data.totals.payslips} />
              <Stat label="Gross" value={formatNaira(data.totals.gross)} />
              <Stat label="Deductions" value={formatNaira(data.totals.deductions)} />
              <Stat label="Net pay" value={formatNaira(data.totals.net)} />
            </div>
            {data.trialBalance !== null && (
              <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                Ledger trial balance for this org:{" "}
                <span className="mono" style={{ color: data.trialBalance === "0" ? "var(--positive)" : "var(--danger)" }}>
                  {formatNaira(data.trialBalance)}
                </span>{" "}
                — every journal entry balances, or it does not exist.
              </p>
            )}
            <a href={`/payroll/${data.run.id}`} style={{ color: "var(--iris)", fontSize: "0.85rem", display: "inline-block", marginTop: "0.75rem" }}>
              View payslips →
            </a>
          </div>
        ) : (
          <p className="card">No payroll runs yet.</p>
        )}

        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>What this proves</h2>
          <ul style={{ color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1.8, paddingLeft: "1.25rem" }}>
            <li>
              Row-level security: <span className="mono">packages/core/tests/rls.spec.ts</span> — Org A provably cannot read Org
              B&apos;s rows, including via an unfiltered scan.
            </li>
            <li>
              Double-entry ledger: <span className="mono">packages/ledger/tests/ledger.spec.ts</span> — trial balance sums to
              exactly 0n under randomized postings; a forged unbalanced entry is rejected by a Postgres trigger, not just
              application code.
            </li>
            <li>
              Payroll math: <span className="mono">packages/rules/tests/golden/ng2026.spec.ts</span> — hand-verified against the
              Nigeria Tax Act 2025 PAYE bands, with sources cited.
            </li>
          </ul>
        </div>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div className="mono" style={{ fontSize: "1.1rem", marginTop: "0.2rem" }}>
        {value}
      </div>
    </div>
  );
}
