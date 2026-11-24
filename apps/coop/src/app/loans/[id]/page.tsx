import { notFound, redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { getCurrentPersona } from "../../../lib/session.js";
import { getDemoOrg } from "../../../lib/org.js";
import { getLoan, getRepaymentSchedule, listGuarantors } from "../../../loans.js";
import { Nav } from "../../nav.js";
import {
  addGuarantorAction,
  approveLoanAction,
  disburseLoanAction,
  postRepaymentAction,
} from "../actions.js";

function formatNaira(minorUnits: bigint): string {
  const negative = minorUnits < 0n;
  const abs = negative ? -minorUnits : minorUnits;
  return `${negative ? "-" : ""}₦${(abs / 100n).toLocaleString("en-NG")}`;
}

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const { id } = await params;
  const canManage = persona.role === "owner" || persona.role === "admin";

  const data = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    const loan = await getLoan(client, id);
    if (!loan || loan.orgId !== org.id) return null;

    const memberResult = await client.query<{ full_name: string; membership_number: string }>(
      "select full_name, membership_number from members where id = $1",
      [loan.memberId],
    );
    const borrower = memberResult.rows[0]!;

    const schedule = await getRepaymentSchedule(client, id);
    const guarantors = await listGuarantors(client, id);
    const guarantorNames = guarantors.length
      ? (
          await client.query<{ id: string; full_name: string }>(
            "select id, full_name from members where id = any($1)",
            [guarantors.map((g) => g.memberId)],
          )
        ).rows
      : [];
    const guarantorNameById = new Map(guarantorNames.map((m) => [m.id, m.full_name]));

    const repaymentsResult = await client.query<{ schedule_id: string; paid_at: string }>(
      "select schedule_id, paid_at from repayments where loan_id = $1",
      [id],
    );
    const paidScheduleIds = new Set(repaymentsResult.rows.map((r) => r.schedule_id));

    const otherMembers = await client.query<{ id: string; membership_number: string; full_name: string }>(
      "select id, membership_number, full_name from members where org_id = $1 and id != $2 order by membership_number",
      [org.id, loan.memberId],
    );

    return { loan, borrower, schedule, guarantors, guarantorNameById, paidScheduleIds, otherMembers: otherMembers.rows };
  });

  if (!data) notFound();
  const { loan, borrower, schedule, guarantors, guarantorNameById, paidScheduleIds, otherMembers } = data;

  const totalPrincipal = schedule.reduce((sum, i) => sum + i.principalDue, 0n);
  const totalInterest = schedule.reduce((sum, i) => sum + i.interestDue, 0n);
  const nextInstallment = schedule.find((i) => !paidScheduleIds.has(i.id));

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <a href="/loans" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          ← Loans
        </a>
        <h1 style={{ fontSize: "1.5rem", margin: "0.5rem 0 0.25rem" }}>{borrower.full_name}</h1>
        <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
          Member #{borrower.membership_number} ·{" "}
          <span style={{ textTransform: "capitalize" }}>{loan.status}</span> · applied{" "}
          {new Date(loan.appliedAt).toLocaleDateString()}
        </p>

        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
            <Stat label="Principal" value={formatNaira(loan.principal)} />
            <Stat label="Rate" value={`${(loan.interestRate * 100).toFixed(1)}% p.a.`} />
            <Stat label="Tenor" value={`${loan.tenorMonths} months`} />
          </div>
          {schedule.length > 0 && (
            <p style={{ marginTop: "1rem", fontSize: "0.8rem", color: "var(--muted)" }}>
              Total repayable: <span className="mono">{formatNaira(totalPrincipal + totalInterest)}</span> (
              {formatNaira(totalPrincipal)} principal + {formatNaira(totalInterest)} interest)
            </p>
          )}
        </div>

        {loan.status === "pending" && canManage && (
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Guarantors</h2>
            <GuarantorList guarantors={guarantors} guarantorNameById={guarantorNameById} />
            {otherMembers.length > 0 && (
              <form action={addGuarantorAction} style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", alignItems: "flex-end" }}>
                <input type="hidden" name="loanId" value={loan.id} />
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)", flex: 1 }}>
                  Guarantor
                  <select
                    name="guarantorMemberId"
                    required
                    style={{ background: "var(--graphite)", border: "1px solid var(--line)", borderRadius: 6, padding: "0.5rem 0.65rem", color: "var(--text)" }}
                  >
                    {otherMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.membership_number} — {m.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                  Amount guaranteed (₦)
                  <input name="amountGuaranteedNaira" type="number" min="1" step="1" required />
                </label>
                <button type="submit" className="btn">
                  Add
                </button>
              </form>
            )}
            <form action={approveLoanAction} style={{ marginTop: "1rem" }}>
              <input type="hidden" name="loanId" value={loan.id} />
              <button type="submit" className="btn">
                Approve loan
              </button>
            </form>
          </div>
        )}

        {guarantors.length > 0 && loan.status !== "pending" && (
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Guarantors</h2>
            <GuarantorList guarantors={guarantors} guarantorNameById={guarantorNameById} />
          </div>
        )}

        {loan.status === "approved" && canManage && (
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <form action={disburseLoanAction}>
              <input type="hidden" name="loanId" value={loan.id} />
              <button type="submit" className="btn">
                Disburse loan
              </button>
            </form>
          </div>
        )}

        {loan.status === "active" && canManage && nextInstallment && (
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Next installment</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
              #{nextInstallment.installmentNo} due {nextInstallment.dueDate} —{" "}
              <span className="mono">{formatNaira(nextInstallment.principalDue + nextInstallment.interestDue)}</span>
            </p>
            <form action={postRepaymentAction}>
              <input type="hidden" name="loanId" value={loan.id} />
              <button type="submit" className="btn">
                Record repayment
              </button>
            </form>
          </div>
        )}

        {schedule.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Due</th>
                  <th>Principal</th>
                  <th>Interest</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((installment) => {
                  const paid = paidScheduleIds.has(installment.id);
                  return (
                    <tr key={installment.installmentNo}>
                      <td className="mono">{installment.installmentNo}</td>
                      <td>{installment.dueDate}</td>
                      <td className="mono">{formatNaira(installment.principalDue)}</td>
                      <td className="mono">{formatNaira(installment.interestDue)}</td>
                      <td className="mono">{formatNaira(installment.principalDue + installment.interestDue)}</td>
                      <td style={{ color: paid ? "var(--positive)" : "var(--muted)" }}>{paid ? "Paid" : "Due"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
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

function GuarantorList({
  guarantors,
  guarantorNameById,
}: {
  guarantors: { id: string; memberId: string; amountGuaranteed: bigint }[];
  guarantorNameById: Map<string, string>;
}) {
  if (guarantors.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No guarantors yet.</p>;
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {guarantors.map((g) => (
        <li key={g.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
          <span>{guarantorNameById.get(g.memberId) ?? g.memberId}</span>
          <span className="mono">{formatNaira(g.amountGuaranteed)}</span>
        </li>
      ))}
    </ul>
  );
}
