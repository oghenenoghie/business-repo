import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../lib/session.js";
import { getDemoOrg } from "../../lib/org.js";
import { Nav } from "../nav.js";

function formatNaira(minorUnits: string | bigint): string {
  const value = typeof minorUnits === "bigint" ? minorUnits : BigInt(minorUnits);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}₦${(abs / 100n).toLocaleString("en-NG")}`;
}

export default async function DashboardPage() {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const data = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);

    const memberCount = await client.query<{ count: string }>("select count(*) from members where org_id = $1", [
      org.id,
    ]);

    const totalSavings = await client.query<{ total: string | null }>(
      `select -coalesce(sum(jl.amount), 0) as total
       from journal_lines jl
       join accounts a on a.id = jl.account_id
       where a.org_id = $1 and a.code = '2100'`,
      [org.id],
    );

    const trialBalance = await client.query<{ total: string }>(
      `select coalesce(sum(jl.amount), 0) as total
       from journal_lines jl join accounts a on a.id = jl.account_id
       where a.org_id = $1`,
      [org.id],
    );

    const contributionCount = await client.query<{ count: string }>(
      "select count(*) from contributions where org_id = $1",
      [org.id],
    );

    return {
      org,
      memberCount: memberCount.rows[0]!.count,
      totalSavings: totalSavings.rows[0]?.total ?? "0",
      trialBalance: trialBalance.rows[0]!.total,
      contributionCount: contributionCount.rows[0]!.count,
    };
  });

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>{data.org.name}</h1>
        <p style={{ color: "var(--muted)", marginBottom: "2rem" }}>{data.memberCount} members</p>

        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Society savings</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
            <Stat label="Members" value={data.memberCount} />
            <Stat label="Contributions posted" value={data.contributionCount} />
            <Stat label="Total member savings" value={formatNaira(data.totalSavings)} />
          </div>
          <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
            Ledger trial balance for this society:{" "}
            <span
              className="mono"
              style={{ color: data.trialBalance === "0" ? "var(--positive)" : "var(--danger)" }}
            >
              {formatNaira(data.trialBalance)}
            </span>{" "}
            — every journal entry balances, or it does not exist.
          </p>
          <a
            href="/members"
            style={{ color: "var(--iris)", fontSize: "0.85rem", display: "inline-block", marginTop: "0.75rem" }}
          >
            View members →
          </a>
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>What this proves</h2>
          <ul style={{ color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1.8, paddingLeft: "1.25rem" }}>
            <li>
              Row-level security: <span className="mono">apps/coop/tests/rls.spec.ts</span> — a member of one
              society provably cannot read another&apos;s members, loans, or loan-child rows.
            </li>
            <li>
              Ledger-derived balances: <span className="mono">apps/coop/tests/contributions.spec.ts</span> — a
              member&apos;s savings balance, computed by walking the ledger, matches the ledger&apos;s own independent
              account balance exactly, and the trial balance stays at zero after every posting.
            </li>
            <li>
              Double-entry ledger: <span className="mono">packages/ledger/tests/ledger.spec.ts</span> — trial
              balance sums to exactly 0n under randomized postings; a forged unbalanced entry is rejected by a
              Postgres trigger, not just application code.
            </li>
          </ul>
        </div>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: "1.1rem", marginTop: "0.2rem" }}>
        {value}
      </div>
    </div>
  );
}
