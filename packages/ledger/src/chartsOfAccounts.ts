import type { PoolClient } from "pg";

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface AccountSeed {
  code: string;
  name: string;
  type: AccountType;
}

// 1xxx Assets · 2xxx Liabilities · 3xxx Equity · 4xxx Revenue · 6xxx Expenses —
// conventional numbering so an accountant can read the chart without a manual.
export const CHARTS_OF_ACCOUNTS: Readonly<Record<"payroll" | "coop" | "hotel", readonly AccountSeed[]>> = {
  payroll: [
    { code: "6000", name: "Salary Expense", type: "expense" },
    { code: "2100", name: "PAYE Payable", type: "liability" },
    { code: "2200", name: "Pension Payable", type: "liability" },
    { code: "2300", name: "NHF Payable", type: "liability" },
    { code: "2400", name: "End-of-Service Provision", type: "liability" },
    { code: "2500", name: "NSITF Payable", type: "liability" },
    { code: "2600", name: "ITF Payable", type: "liability" },
    { code: "2900", name: "Net Pay Payable", type: "liability" },
  ],
  coop: [
    { code: "1000", name: "Bank", type: "asset" },
    { code: "1100", name: "Loans Receivable", type: "asset" },
    { code: "1150", name: "Interest Receivable", type: "asset" },
    { code: "2100", name: "Member Savings", type: "liability" },
    { code: "2150", name: "Dividends Payable", type: "liability" },
    { code: "3100", name: "Share Capital", type: "equity" },
    { code: "4100", name: "Interest Income", type: "revenue" },
    { code: "6100", name: "Dividends", type: "expense" },
    { code: "6200", name: "Bad Debt", type: "expense" },
  ],
  hotel: [
    { code: "1200", name: "Guest Folios (AR)", type: "asset" },
    { code: "4000", name: "Room Revenue", type: "revenue" },
    { code: "4100", name: "F&B Revenue", type: "revenue" },
    { code: "2500", name: "Tax Payable", type: "liability" },
    { code: "2600", name: "Deposits Held", type: "liability" },
  ],
};

export async function seedChartOfAccounts(
  client: PoolClient,
  orgId: string,
  chart: keyof typeof CHARTS_OF_ACCOUNTS,
  currency: string,
): Promise<void> {
  for (const account of CHARTS_OF_ACCOUNTS[chart]) {
    await client.query(
      `insert into accounts (org_id, code, name, type, currency)
       values ($1, $2, $3, $4, $5)
       on conflict (org_id, code) do nothing`,
      [orgId, account.code, account.name, account.type, currency],
    );
  }
}
