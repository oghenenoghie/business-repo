import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../lib/session";
import { getDemoOrg } from "../../lib/org";
import { Nav } from "../nav";

export default async function PayrollRunsPage() {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const runs = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    const result = await client.query<{
      id: string;
      period: string;
      jurisdiction: string;
      status: string;
      approved_at: string | null;
    }>("select id, period, jurisdiction, status, approved_at from payroll_runs where org_id = $1 order by period desc", [org.id]);
    return result.rows;
  });

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Payroll runs</h1>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Jurisdiction</th>
                <th>Status</th>
                <th>Approved</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="mono">{run.period}</td>
                  <td>{run.jurisdiction}</td>
                  <td style={{ textTransform: "capitalize" }}>{run.status}</td>
                  <td className="mono">{run.approved_at ? new Date(run.approved_at).toLocaleDateString() : "—"}</td>
                  <td>
                    <a href={`/payroll/${run.id}`} style={{ color: "var(--iris)" }}>
                      View →
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
