import { notFound, redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../../lib/session.js";
import { getDemoOrg } from "../../../lib/org.js";
import { getMemberStatement } from "../../../statement.js";
import { Nav } from "../../nav.js";

function formatNaira(minorUnits: bigint): string {
  const negative = minorUnits < 0n;
  const abs = negative ? -minorUnits : minorUnits;
  return `${negative ? "-" : ""}₦${(abs / 100n).toLocaleString("en-NG")}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function MemberStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const { id } = await params;

  const statement = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    return getMemberStatement(client, org.id, id);
  });

  if (!statement) notFound();

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <a href="/members" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          ← Members
        </a>
        <h1 style={{ fontSize: "1.5rem", margin: "0.5rem 0 0.25rem" }}>{statement.member.fullName}</h1>
        <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
          Member #{statement.member.membershipNumber} · joined {statement.member.joinDate} ·{" "}
          <span style={{ textTransform: "capitalize" }}>{statement.member.status}</span>
        </p>

        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div style={{ color: "var(--muted)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            Savings balance
          </div>
          <div className="mono" style={{ fontSize: "1.75rem", marginTop: "0.25rem" }}>
            {formatNaira(statement.savingsBalance)}
          </div>
          <p style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
            Derived from the ledger — every contribution below is a real journal entry, summed live, not a stored
            column.
          </p>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Contribution</th>
                <th>Running balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line) => (
                <tr key={line.contributionId}>
                  <td>
                    {MONTHS[line.periodMonth - 1]} {line.periodYear}
                  </td>
                  <td className="mono">{formatNaira(line.amount)}</td>
                  <td className="mono">{formatNaira(line.runningBalance)}</td>
                </tr>
              ))}
              {statement.lines.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ color: "var(--muted)" }}>
                    No contributions posted yet.
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
