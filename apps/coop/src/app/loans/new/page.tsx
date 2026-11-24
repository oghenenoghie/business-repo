import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../../lib/session.js";
import { getDemoOrg } from "../../../lib/org.js";
import { Nav } from "../../nav.js";
import { LoanApplicationForm } from "./LoanApplicationForm.js";

export default async function NewLoanPage() {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");
  if (persona.role !== "owner" && persona.role !== "admin") redirect("/loans");

  const members = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    const result = await client.query<{ id: string; membership_number: string; full_name: string }>(
      "select id, membership_number, full_name from members where org_id = $1 order by membership_number",
      [org.id],
    );
    return result.rows.map((r) => ({ id: r.id, membershipNumber: r.membership_number, fullName: r.full_name }));
  });

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <a href="/loans" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          ← Loans
        </a>
        <h1 style={{ fontSize: "1.5rem", margin: "0.5rem 0 1.5rem" }}>Apply for a loan</h1>

        <div className="card">
          {members.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>
              No members yet — <a href="/members" style={{ color: "var(--iris)" }}>add one first</a>.
            </p>
          ) : (
            <LoanApplicationForm members={members} />
          )}
        </div>
      </main>
    </>
  );
}
