import { notFound, redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../../lib/session.js";
import { getDemoOrg } from "../../../lib/org.js";
import { getLoan, getRepaymentSchedule, listGuarantors } from "../../../loans.js";
import { Nav } from "../../nav.js";
import { addGuarantorAction, approveLoanAction, disburseLoanAction, postRepaymentAction } from "../actions.js";

function formatNaira(minorUnits: bigint): string {
  const negative = minorUnits < 0n;
  const abs = negative ? -minorUnits : minorUnits;
  return `${negative ? "-" : ""}₦${(abs / 100n).toLocaleString("en-NG")}`;
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

export default async function LoanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const { id } = await params;
  const { error } = await searchParams;

  const data = await withUserContext(persona.id, async (client) => {
    const loan = await getLoan(client, id);
    if (!loan) return null;

    const org = await getDemoOrg(client);
    const memberResult = await client.query<{ full_name: string; membership_number: string }>(
      "select full_name, membership_number from members where id = $1",
      [loan.memberId],
    );
    const member = memberResult.rows[0]!;

    const schedule = await getRepaymentSchedule(client, id);
    const repaymentsResult = await client.query<{ schedule_id: string | null; paid_at: string }>(
      "select schedule_id, paid_at from repayments where loan_id = $1",
      [id],
    );
    const paidScheduleIds = new Set(repaymentsResult.rows.map((r) => r.schedule_id));

    const guarantors = await listGuarantors(client, id);
    const guarantorMemberIds = guarantors.map((g) => g.memberId);
    const guarantorNamesResult = await client.query<{ id: string; full_name: string; membership_number: string }>(
      "select id, full_name, membership_number from members where id = any($1)",
      [guarantorMemberIds.length > 0 ? guarantorMemberIds : [null]],
    );
    const guarantorNames = new Map(guarantorNamesResult.rows.map((r) => [r.id, r]));

    const eligibleGuarantorsResult = await client.query<{ id: string; membership_number: string; full_name: string }>(
      `select id, membership_number, full_name from members
       where org_id = $1 and status = 'active' and id != $2
         and id != all($3)
       order by membership_number`,
      [org.id, loan.memberId, guarantorMemberIds.length > 0 ? guarantorMemberIds : [null]],
    );

    return {
      loan,
      member,
      schedule,
      paidScheduleIds,
      guarantors,
      guarantorNames,
      eligibleGuarantors: eligibleGuarantorsResult.rows,
    };
  });

  if (!data) notFound();
  const { loan, member, schedule, paidScheduleIds, guarantors, guarantorNames, eligibleGuarantors } = data;

  const canManage = persona.role === "owner" || persona.role === "admin";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <a href="/loans" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          ← Loans
        </a>

        {error && (
          <div
            className="card"
            style={{ margin: "1rem 0", borderColor: "var(--danger)", color: "var(--danger)", fontSize: "0.85rem" }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", margin: "0.5rem 0 1.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>
              <a href={`/members/${loan.memberId}`} style={{ color: "var(--text)" }}>
                {member.full_name}
              </a>
            </h1>
            <p style={{ color: "var(--muted)" }}>
              Member #{member.membership_number} · {formatNaira(loan.principal)} at {(loan.interestRate * 100).toFixed(1)}%
              /yr over {loan.tenorMonths} months · <span style={{ textTransform: "capitalize" }}>{loan.method.replace("_", " ")}</span>
            </p>
          </div>
          <span
            style={{
              color: STATUS_COLOR[loan.status] ?? "var(--text)",
              textTransform: "capitalize",
              border: `1px solid ${STATUS_COLOR[loan.status] ?? "var(--line)"}`,
              borderRadius: 999,
              padding: "0.25rem 0.75rem",
              fontSize: "0.8rem",
            }}
          >
            {loan.status}
          </span>
        </div>

        {canManage && (loan.status === "pending" || loan.status === "approved" || loan.status === "active") && (
          <div className="card" style={{ marginBottom: "1.5rem", display: "flex", gap: "0.75rem" }}>
            {loan.status === "pending" && (
              <form action={approveLoanAction}>
                <input type="hidden" name="loanId" value={loan.id} />
                <button type="submit" className="btn">
                  Approve loan
                </button>
              </form>
            )}
            {loan.status === "approved" && (
              <form action={disburseLoanAction}>
                <input type="hidden" name="loanId" value={loan.id} />
                <button type="submit" className="btn">
                  Disburse
                </button>
              </form>
            )}
            {loan.status === "active" && (
              <form action={postRepaymentAction}>
                <input type="hidden" name="loanId" value={loan.id} />
                <button type="submit" className="btn">
                  Post next repayment
                </button>
              </form>
            )}
          </div>
        )}

        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "1.5rem" }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Due date</th>
                <th>Principal</th>
                <th>Interest</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((installment) => {
                const paid = paidScheduleIds.has(installment.id);
                const overdue = !paid && installment.dueDate < today;
                return (
                  <tr key={installment.id}>
                    <td>{installment.installmentNo}</td>
                    <td>{installment.dueDate}</td>
                    <td className="mono">{formatNaira(installment.principalDue)}</td>
                    <td className="mono">{formatNaira(installment.interestDue)}</td>
                    <td className="mono">{formatNaira(installment.principalDue + installment.interestDue)}</td>
                    <td style={{ color: paid ? "var(--positive)" : overdue ? "var(--danger)" : "var(--muted)" }}>
                      {paid ? "Paid" : overdue ? "Overdue" : "Upcoming"}
                    </td>
                  </tr>
                );
              })}
              {schedule.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)" }}>
                    No schedule yet — this loan hasn&apos;t been disbursed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Guarantors</h2>
          <table style={{ marginBottom: guarantors.length > 0 ? "1.25rem" : 0 }}>
            <thead>
              <tr>
                <th>Member</th>
                <th>Amount guaranteed</th>
              </tr>
            </thead>
            <tbody>
              {guarantors.map((g) => {
                const m = guarantorNames.get(g.memberId);
                return (
                  <tr key={g.id}>
                    <td>
                      <a href={`/members/${g.memberId}`} style={{ color: "var(--iris)" }}>
                        {m ? m.full_name : g.memberId}
                      </a>
                      {m && <span style={{ color: "var(--muted)" }}> ({m.membership_number})</span>}
                    </td>
                    <td className="mono">{formatNaira(g.amountGuaranteed)}</td>
                  </tr>
                );
              })}
              {guarantors.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ color: "var(--muted)" }}>
                    No guarantors yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {canManage && loan.status === "pending" && eligibleGuarantors.length > 0 && (
            <form action={addGuarantorAction} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
              <input type="hidden" name="loanId" value={loan.id} />
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)", flex: 1 }}>
                Member
                <select
                  name="memberId"
                  required
                  style={{ background: "var(--graphite)", border: "1px solid var(--line)", borderRadius: 6, padding: "0.5rem 0.65rem", color: "var(--text)" }}
                >
                  {eligibleGuarantors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.membership_number} — {m.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                Amount (₦)
                <input name="amountNaira" type="number" min="1" step="1" required />
              </label>
              <button type="submit" className="btn">
                Add guarantor
              </button>
            </form>
          )}
        </div>
      </main>
    </>
  );
}
