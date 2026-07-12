import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../../lib/session";
import { Nav } from "../../nav";

function formatNaira(minorUnits: string): string {
  const value = BigInt(minorUnits);
  return `₦${(value / 100n).toLocaleString("en-NG")}`;
}

export default async function PayrollRunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const data = await withUserContext(persona.id, async (client) => {
    const run = await client.query<{ period: string; status: string; jurisdiction: string; journal_entry_id: string | null }>(
      "select period, status, jurisdiction, journal_entry_id from payroll_runs where id = $1",
      [runId],
    );
    const payslips = await client.query<{
      id: string;
      staff_number: string;
      full_name: string;
      gross: string;
      total_deductions: string;
      net: string;
    }>(
      `select p.id, e.staff_number, e.full_name, p.gross, p.total_deductions, p.net
       from payslips p join employees e on e.id = p.employee_id
       where p.run_id = $1
       order by e.staff_number`,
      [runId],
    );
    return { run: run.rows[0] ?? null, payslips: payslips.rows };
  });

  if (!data.run) redirect("/payroll");

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <a href="/payroll" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          ← All runs
        </a>
        <h1 style={{ fontSize: "1.5rem", margin: "0.5rem 0 1.5rem" }}>
          Payroll — {data.run.period} ({data.run.jurisdiction})
        </h1>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Staff #</th>
                <th>Employee</th>
                <th>Gross</th>
                <th>Deductions</th>
                <th>Net pay</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.payslips.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.staff_number}</td>
                  <td>{p.full_name}</td>
                  <td className="mono">{formatNaira(p.gross)}</td>
                  <td className="mono">{formatNaira(p.total_deductions)}</td>
                  <td className="mono">{formatNaira(p.net)}</td>
                  <td>
                    <a href={`/api/payslip/${p.id}/pdf`} style={{ color: "var(--iris)", fontSize: "0.85rem" }}>
                      PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
