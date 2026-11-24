import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../lib/session.js";
import { getDemoOrg } from "../../lib/org.js";
import { getArrearsReport } from "../../loans.js";
import { Nav } from "../nav.js";

function formatNaira(minorUnits: string | bigint): string {
  const value = typeof minorUnits === "bigint" ? minorUnits : BigInt(minorUnits);
  return `₦${(value / 100n).toLocaleString("en-NG")}`;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--warning)",
  approved: "var(--warning)",
  disbursed: "var(--iris)",
  active: "var(--iris)",
  repaid: "var(--positive)",
  defaulted: "var(--danger)",
  rescheduled: "var(--muted)",
};

// getArrearsReport only returns installments already past due — "current"
// means overdue but under 30 days, not "not yet due".
const BUCKET_LABEL: Record<string, string> = {
  current: "<30 days overdue",
  "30": "30-59 days overdue",
  "60": "60-89 days overdue",
  "90+": "90+ days overdue",
};

export default async function LoansPage() {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const { loans, arrears } = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    const loansResult = await client.query<{
      id: string;
      member_name: string;
      membership_number: string;
      principal: string;
      interest_rate: string;
      tenor_months: number;
      method: string;
      status: string;
      applied_at: string;
    }>(
      `select l.id, m.full_name as member_name, m.membership_number, l.principal, l.interest_rate,
              l.tenor_months, l.method, l.status, l.applied_at
       from loans l
       join members m on m.id = l.member_id
       where l.org_id = $1
       order by l.applied_at desc`,
      [org.id],
    );
    const arrears = await getArrearsReport(client, org.id);
    return { loans: loansResult.rows, arrears };
  });

  const canApply = persona.role === "owner" || persona.role === "admin";

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem" }}>
          <h1 style={{ fontSize: "1.5rem" }}>Loans</h1>
          {canApply && (
            <a href="/loans/new" className="btn" style={{ textDecoration: "none" }}>
              New application
            </a>
          )}
        </div>

        {arrears.length > 0 && (
          <div className="card" style={{ marginBottom: "1.5rem", borderColor: "var(--danger)" }}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem", color: "var(--danger)" }}>
              {arrears.length} overdue installment{arrears.length === 1 ? "" : "s"}
            </h2>
            <table>
              <thead>
                <tr>
                  <th>Loan</th>
                  <th>Installment</th>
                  <th>Due</th>
                  <th>Amount</th>
                  <th>Bucket</th>
                </tr>
              </thead>
              <tbody>
                {arrears.slice(0, 10).map((row) => (
                  <tr key={`${row.loanId}-${row.installmentNo}`}>
                    <td>
                      <a href={`/loans/${row.loanId}`} style={{ color: "var(--iris)" }}>
                        View loan
                      </a>
                    </td>
                    <td>#{row.installmentNo}</td>
                    <td>{row.dueDate}</td>
                    <td className="mono">{formatNaira(row.amountDue)}</td>
                    <td style={{ color: "var(--danger)" }}>{BUCKET_LABEL[row.bucket]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Principal</th>
                <th>Rate</th>
                <th>Tenor</th>
                <th>Method</th>
                <th>Status</th>
                <th>Applied</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id}>
                  <td>
                    <a href={`/loans/${l.id}`} style={{ color: "var(--iris)" }}>
                      {l.member_name}
                    </a>
                    <span style={{ color: "var(--muted)" }}> ({l.membership_number})</span>
                  </td>
                  <td className="mono">{formatNaira(l.principal)}</td>
                  <td className="mono">{(Number(l.interest_rate) * 100).toFixed(1)}%</td>
                  <td>{l.tenor_months} mo</td>
                  <td style={{ textTransform: "capitalize" }}>{l.method.replace("_", " ")}</td>
                  <td>
                    <span style={{ color: STATUS_COLOR[l.status] ?? "var(--text)", textTransform: "capitalize" }}>
                      {l.status}
                    </span>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{new Date(l.applied_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {loans.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--muted)" }}>
                    No loans yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
