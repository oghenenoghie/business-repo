import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../lib/session.js";
import { getDemoOrg } from "../../lib/org.js";
import { Nav } from "../nav.js";
import { createMemberAction } from "./actions.js";

function formatNaira(minorUnits: string): string {
  const value = BigInt(minorUnits);
  return `₦${(value / 100n).toLocaleString("en-NG")}`;
}

export default async function MembersPage() {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const members = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    const result = await client.query<{
      id: string;
      membership_number: string;
      full_name: string;
      status: string;
      join_date: string;
      savings: string | null;
    }>(
      `select m.id, m.membership_number, m.full_name, m.status, m.join_date::text as join_date,
              (
                select -coalesce(sum(jl.amount), 0)
                from contributions c
                join journal_lines jl on jl.entry_id = c.journal_entry_id
                join accounts a on a.id = jl.account_id
                where c.member_id = m.id and a.code = '2100'
              ) as savings
       from members m
       where m.org_id = $1
       order by m.membership_number`,
      [org.id],
    );
    return result.rows;
  });

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem" }}>
          <h1 style={{ fontSize: "1.5rem" }}>Members</h1>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "1.5rem" }}>
          <table>
            <thead>
              <tr>
                <th>Member #</th>
                <th>Name</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Savings balance</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.membership_number}</td>
                  <td>
                    <a href={`/members/${m.id}`} style={{ color: "var(--iris)" }}>
                      {m.full_name}
                    </a>
                  </td>
                  <td style={{ textTransform: "capitalize" }}>{m.status}</td>
                  <td>{m.join_date}</td>
                  <td className="mono">{formatNaira(m.savings ?? "0")}</td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)" }}>
                    No members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {(persona.role === "owner" || persona.role === "admin") && (
          <div className="card">
            <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Add a member</h2>
            <form action={createMemberAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 420 }}>
              <Field label="Membership number" name="membershipNumber" type="text" required />
              <Field label="Full name" name="fullName" type="text" required />
              <Field label="Join date" name="joinDate" type="date" required />
              <Field label="Phone" name="phone" type="tel" />
              <Field label="Email" name="email" type="email" />
              <button type="submit" className="btn" style={{ alignSelf: "flex-start" }}>
                Add member
              </button>
            </form>
          </div>
        )}
      </main>
    </>
  );
}

function Field({ label, name, type, required }: { label: string; name: string; type: string; required?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
      {label}
      <input name={name} type={type} required={required} />
    </label>
  );
}
