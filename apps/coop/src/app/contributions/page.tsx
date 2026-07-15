import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../lib/session.js";
import { getDemoOrg } from "../../lib/org.js";
import { Nav } from "../nav.js";
import { postContributionAction } from "./actions.js";

function formatNaira(minorUnits: string): string {
  const value = BigInt(minorUnits);
  return `₦${(value / 100n).toLocaleString("en-NG")}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function ContributionsPage() {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const { members, recent } = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    const membersResult = await client.query<{ id: string; membership_number: string; full_name: string }>(
      "select id, membership_number, full_name from members where org_id = $1 order by membership_number",
      [org.id],
    );
    const recentResult = await client.query<{
      id: string;
      member_name: string;
      period_year: number;
      period_month: number;
      amount: string;
      posted_at: string;
    }>(
      `select c.id, m.full_name as member_name, c.period_year, c.period_month, c.amount, c.posted_at
       from contributions c join members m on m.id = c.member_id
       where c.org_id = $1
       order by c.posted_at desc
       limit 20`,
      [org.id],
    );
    return { members: membersResult.rows, recent: recentResult.rows };
  });

  const now = new Date();
  const canPost = persona.role === "owner" || persona.role === "admin";

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Contributions</h1>

        {canPost && (
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Post a contribution</h2>
            <form
              action={postContributionAction}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 420 }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                Member
                <select name="memberId" required style={{ background: "var(--graphite)", border: "1px solid var(--line)", borderRadius: 6, padding: "0.5rem 0.65rem", color: "var(--text)" }}>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.membership_number} — {m.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)", flex: 1 }}>
                  Year
                  <input name="periodYear" type="number" defaultValue={now.getFullYear()} required />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)", flex: 1 }}>
                  Month
                  <select name="periodMonth" defaultValue={now.getMonth() + 1} style={{ background: "var(--graphite)", border: "1px solid var(--line)", borderRadius: 6, padding: "0.5rem 0.65rem", color: "var(--text)" }}>
                    {MONTHS.map((name, i) => (
                      <option key={name} value={i + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                Amount (₦)
                <input name="amountNaira" type="number" min="1" step="1" required />
              </label>
              <button type="submit" className="btn" style={{ alignSelf: "flex-start" }}>
                Post contribution
              </button>
            </form>
            {members.length === 0 && (
              <p style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                No members yet — <a href="/members" style={{ color: "var(--iris)" }}>add one first</a>.
              </p>
            )}
          </div>
        )}

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Period</th>
                <th>Amount</th>
                <th>Posted</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => (
                <tr key={c.id}>
                  <td>{c.member_name}</td>
                  <td>
                    {MONTHS[c.period_month - 1]} {c.period_year}
                  </td>
                  <td className="mono">{formatNaira(c.amount)}</td>
                  <td style={{ color: "var(--muted)" }}>{new Date(c.posted_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ color: "var(--muted)" }}>
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
