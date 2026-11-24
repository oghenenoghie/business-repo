import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../../lib/session.js";
import { getDemoOrg } from "../../../lib/org.js";
import { getSavingsMultiplier } from "../../../loans.js";
import { Nav } from "../../nav.js";
import { LoanApplicationForm } from "./LoanApplicationForm.js";

export default async function NewLoanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");
  if (persona.role !== "owner" && persona.role !== "admin") redirect("/loans");

  const { error } = await searchParams;

  const { members, multiplier } = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    const membersResult = await client.query<{ id: string; membership_number: string; full_name: string }>(
      "select id, membership_number, full_name from members where org_id = $1 and status = 'active' order by membership_number",
      [org.id],
    );
    const multiplier = await getSavingsMultiplier(client, org.id);
    return { members: membersResult.rows, multiplier };
  });

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <a href="/loans" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          ← Loans
        </a>
        <h1 style={{ fontSize: "1.5rem", margin: "0.5rem 0 1.5rem" }}>New loan application</h1>

        {error && (
          <div
            className="card"
            style={{ marginBottom: "1.5rem", borderColor: "var(--danger)", color: "var(--danger)", fontSize: "0.85rem" }}
          >
            {error}
          </div>
        )}

        <div className="card">
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "1rem" }}>
            This society lends up to {multiplier}× a member&apos;s savings, less any outstanding loans and anything
            they&apos;ve guaranteed for others. Eligibility below updates as you type.
          </p>
          <LoanApplicationForm members={members} />
        </div>
      </main>
    </>
  );
}
