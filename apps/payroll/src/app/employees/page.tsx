import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../lib/session";
import { getDemoOrg } from "../../lib/org";
import { Nav } from "../nav";

function formatNaira(minorUnits: string): string {
  const value = BigInt(minorUnits);
  return `₦${(value / 100n).toLocaleString("en-NG")}`;
}

export default async function EmployeesPage() {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const employees = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    const result = await client.query<{
      staff_number: string;
      full_name: string;
      nationality: string;
      pension_opt_in: boolean;
      nhf_opt_in: boolean;
      basic: string;
    }>(
      `select e.staff_number, e.full_name, e.nationality, e.pension_opt_in, e.nhf_opt_in, er.basic
       from employees e
       join lateral (
         select basic from employment_records
         where employee_id = e.id order by effective_from desc limit 1
       ) er on true
       where e.org_id = $1
       order by e.staff_number`,
      [org.id],
    );
    return result.rows;
  });

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Employees</h1>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Staff #</th>
                <th>Name</th>
                <th>Nationality</th>
                <th>Basic (monthly)</th>
                <th>Pension</th>
                <th>NHF</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.staff_number}>
                  <td className="mono">{e.staff_number}</td>
                  <td>{e.full_name}</td>
                  <td>{e.nationality}</td>
                  <td className="mono">{formatNaira(e.basic)}</td>
                  <td style={{ color: e.pension_opt_in ? "var(--positive)" : "var(--muted)" }}>{e.pension_opt_in ? "Opted in" : "—"}</td>
                  <td style={{ color: e.nhf_opt_in ? "var(--positive)" : "var(--muted)" }}>{e.nhf_opt_in ? "Opted in" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
