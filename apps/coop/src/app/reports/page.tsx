import { redirect } from "next/navigation";
import { withUserContext } from "@bp/core";
import { balance, trialBalance } from "@bp/ledger";
import { getCurrentPersona } from "../../lib/session.js";
import { getDemoOrg } from "../../lib/org.js";
import { getArrearsReport } from "../../loans.js";
import { listInterestAccrualRuns } from "../../interestAccrual.js";
import { listDividendRuns } from "../../dividends.js";
import { Nav } from "../nav.js";

function formatNaira(minorUnits: bigint): string {
  const negative = minorUnits < 0n;
  const abs = negative ? -minorUnits : minorUnits;
  return `${negative ? "-" : ""}₦${(abs / 100n).toLocaleString("en-NG")}`;
}

const KEY_ACCOUNTS = [
  { code: "1000", name: "Bank" },
  { code: "1100", name: "Loans Receivable" },
  { code: "1150", name: "Interest Receivable" },
  { code: "2100", name: "Member Savings" },
  { code: "2150", name: "Dividends Payable" },
  { code: "4100", name: "Interest Income" },
] as const;

// getArrearsReport only returns installments already past due — "current"
// means overdue but under 30 days, not "not yet due".
const BUCKET_LABEL: Record<string, string> = {
  current: "<30 days overdue",
  "30": "30-59 days overdue",
  "60": "60-89 days overdue",
  "90+": "90+ days overdue",
};

const DIVIDEND_STATUS_COLOR: Record<string, string> = {
  draft: "var(--muted)",
  allocated: "var(--warning)",
  approved: "var(--warning)",
  posted: "var(--positive)",
};

export default async function ReportsPage() {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const data = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    const totals = await trialBalance(client, org.id);
    const accountBalances = await Promise.all(
      KEY_ACCOUNTS.map(async (account) => ({ ...account, balance: await balance(client, org.id, account.code) })),
    );
    const arrears = await getArrearsReport(client, org.id);
    const accrualRuns = await listInterestAccrualRuns(client, org.id);
    const dividendRuns = await listDividendRuns(client, org.id);
    return { totals, accountBalances, arrears, accrualRuns, dividendRuns };
  });

  const bucketOrder = ["current", "30", "60", "90+"] as const;
  const bucketSummary = bucketOrder
    .map((bucket) => ({
      bucket,
      count: data.arrears.filter((r) => r.bucket === bucket).length,
      total: data.arrears.filter((r) => r.bucket === bucket).reduce((sum, r) => sum + r.amountDue, 0n),
    }))
    .filter((row) => row.count > 0);
  const arrearsTotal = data.arrears.reduce((sum, r) => sum + r.amountDue, 0n);

  return (
    <>
      <Nav persona={persona} />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1.5rem" }}>Reports</h1>

        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Trial balance</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "1rem" }}>
            Sum of every journal line ever posted for this society. Every entry balances, or it does not exist —
            this should always read exactly zero.
          </p>
          {Object.entries(data.totals).map(([currency, total]) => (
            <div key={currency} style={{ marginBottom: "1rem" }}>
              <span
                className="mono"
                style={{ fontSize: "1.5rem", color: total === 0n ? "var(--positive)" : "var(--danger)" }}
              >
                {formatNaira(total)}
              </span>
              <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>{currency}</span>
            </div>
          ))}
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Balance (Dr positive, Cr negative)</th>
              </tr>
            </thead>
            <tbody>
              {data.accountBalances.map((account) => (
                <tr key={account.code}>
                  <td>
                    <span className="mono" style={{ color: "var(--muted)" }}>
                      {account.code}
                    </span>{" "}
                    {account.name}
                  </td>
                  <td className="mono">{formatNaira(account.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Loan book ageing</h2>
          {bucketSummary.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No overdue installments.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Installments</th>
                  <th>Amount overdue</th>
                </tr>
              </thead>
              <tbody>
                {bucketSummary.map((row) => (
                  <tr key={row.bucket}>
                    <td style={{ color: "var(--danger)" }}>{BUCKET_LABEL[row.bucket]}</td>
                    <td>{row.count}</td>
                    <td className="mono">{formatNaira(row.total)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ color: "var(--muted)" }}>Total</td>
                  <td>{data.arrears.length}</td>
                  <td className="mono">{formatNaira(arrearsTotal)}</td>
                </tr>
              </tbody>
            </table>
          )}
          <a href="/loans" style={{ color: "var(--iris)", fontSize: "0.85rem", display: "inline-block", marginTop: "0.75rem" }}>
            View overdue loans →
          </a>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          <div className="card">
            <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Interest accrual runs</h2>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.accrualRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{run.runDate}</td>
                    <td className="mono">{formatNaira(run.amount)}</td>
                  </tr>
                ))}
                {data.accrualRuns.length === 0 && (
                  <tr>
                    <td colSpan={2} style={{ color: "var(--muted)" }}>
                      No accrual runs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Dividend runs</h2>
            <table>
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Surplus</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.dividendRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{run.financialYear}</td>
                    <td className="mono">{formatNaira(run.distributableSurplus)}</td>
                    <td style={{ color: DIVIDEND_STATUS_COLOR[run.status] ?? "var(--text)", textTransform: "capitalize" }}>
                      {run.status}
                    </td>
                  </tr>
                ))}
                {data.dividendRuns.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: "var(--muted)" }}>
                      No dividend runs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
