import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../lib/session.js";
import { getDemoOrg } from "../../lib/org.js";
import { getArrearsReport } from "../../loans.js";
import { Nav } from "../nav.js";
import type { LoanStatus } from "../../types.js";

function formatNaira(minorUnits: string | bigint): string {
  const value = typeof minorUnits === "bigint" ? minorUnits : BigInt(minorUnits);
  return `₦${(value / 100n).toLocaleString("en-NG")}`;
}

const STATUS_COLOR: Record<LoanStatus, string> = {
  pending: "var(--warning)",
  approved: "var(--iris)",
  disbursed: "var(--iris)",
  active: "var(--positive)",
  repaid: "var(--muted)",
  defaulted: "var(--danger)",
  rescheduled: "var(--warning)",
};

const BUCKET_LABEL: Record<string, string> = {
  current: "Not yet due",
  "30": "30+ days",
  "60": "60+ days",
  "90+": "90+ days",
};

export default async function LoansPage() {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const { loans, arrears } = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    const loansResult = await client.query<{
      id: string;
      member_name: string;
      principal: string;
      interest_rate: string;
      tenor_months: number;
      status: LoanStatus;
      applied_at: string;
    }>(
      `select l.id, m.full_name as member_name, l.principal, l.interest_rate, l.tenor_months, l.status, l.applied_at
       from loans l join members m on m.id = l.member_id
       where l.org_id = $1
       order by l.applied_at desc`,
      [org.id],
    );
    const arrearsRows = await getArrearsReport(client, org.id);
    return { loans: loansResult.rows, arrears: arrearsRows };
  });

  const canManage = persona.role === "owner" || persona.role === "admin";

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.5rem" }}>Loans</h1>
          {canManage && (
            <a href="/loans/new" className="btn">
              Apply for a loan
            </a>
          )}
        </div>

        {arrears.length > 0 && (
          <div className="card" style={{ marginBottom: "1.5rem", borderColor: "var(--danger)" }}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem", color: "var(--danger)" }}>
              {arrears.length} installment{arrears.length === 1 ? "" : "s"} overdue
            </h2>
            <table>
              <thead>
                <tr>
                  <th>Loan</th>
                  <th>Installment</th>
                  <th>Due</th>
                  <th>Amount</th>
                  <th>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {arrears.map((row) => (
                  <tr key={`${row.loanId}-${row.installmentNo}`}>
                    <td>
                      <a href={`/loans/${row.loanId}`} style={{ color: "var(--iris)" }}>
                        {row.loanId.slice(0, 8)}
                      </a>
                    </td>
                    <td className="mono">#{row.installmentNo}</td>
                    <td>{row.dueDate}</td>
                    <td className="mono">{formatNaira(row.amountDue)}</td>
                    <td style={{ color: "var(--danger)" }}>
                      {row.daysOverdue}d ({BUCKET_LABEL[row.bucket]})
                    </td>
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
                  </td>
                  <td className="mono">{formatNaira(l.principal)}</td>
                  <td className="mono">{(Number(l.interest_rate) * 100).toFixed(1)}%</td>
                  <td>{l.tenor_months} mo</td>
                  <td style={{ color: STATUS_COLOR[l.status], textTransform: "capitalize" }}>{l.status}</td>
                  <td style={{ color: "var(--muted)" }}>{new Date(l.applied_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {loans.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)" }}>
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
