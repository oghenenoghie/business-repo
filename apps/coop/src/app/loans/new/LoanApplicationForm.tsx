"use client";

import { useEffect, useState } from "react";
import { applyForLoanAction, checkEligibilityAction } from "../actions.js";
import type { EligibilityCheck } from "../../../types.js";

function formatNaira(minorUnits: string): string {
  const value = BigInt(minorUnits);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}₦${(abs / 100n).toLocaleString("en-NG")}`;
}

interface MemberOption {
  id: string;
  membership_number: string;
  full_name: string;
}

export function LoanApplicationForm({ members }: { members: MemberOption[] }) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [principalNaira, setPrincipalNaira] = useState("");
  const [eligibility, setEligibility] = useState<EligibilityCheck | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const amount = Number(principalNaira);
    if (!memberId || !amount || amount <= 0) {
      setEligibility(null);
      return;
    }
    setChecking(true);
    const timer = setTimeout(() => {
      checkEligibilityAction(memberId, amount)
        .then(setEligibility)
        .finally(() => setChecking(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [memberId, principalNaira]);

  return (
    <form action={applyForLoanAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
        Member
        <select
          name="memberId"
          required
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          style={{ background: "var(--graphite)", border: "1px solid var(--line)", borderRadius: 6, padding: "0.5rem 0.65rem", color: "var(--text)" }}
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.membership_number} — {m.full_name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
        Principal (₦)
        <input
          name="principalNaira"
          type="number"
          min="1"
          step="1"
          required
          value={principalNaira}
          onChange={(e) => setPrincipalNaira(e.target.value)}
        />
      </label>

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)", flex: 1 }}>
          Interest rate (% per annum)
          <input name="interestRatePercent" type="number" min="0" step="0.1" defaultValue="15" required />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)", flex: 1 }}>
          Tenor (months)
          <input name="tenorMonths" type="number" min="1" step="1" defaultValue="6" required />
        </label>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
        Amortization method
        <select
          name="method"
          defaultValue="flat"
          style={{ background: "var(--graphite)", border: "1px solid var(--line)", borderRadius: 6, padding: "0.5rem 0.65rem", color: "var(--text)" }}
        >
          <option value="flat">Flat rate</option>
          <option value="reducing_balance">Reducing balance</option>
        </select>
      </label>

      <div
        style={{
          padding: "0.85rem",
          borderRadius: 6,
          background: "var(--graphite)",
          border: `1px solid ${eligibility ? (eligibility.eligible ? "var(--positive)" : "var(--danger)") : "var(--line)"}`,
          fontSize: "0.85rem",
        }}
      >
        {!memberId || !principalNaira ? (
          <span style={{ color: "var(--muted)" }}>Pick a member and an amount to check eligibility.</span>
        ) : checking && !eligibility ? (
          <span style={{ color: "var(--muted)" }}>Checking…</span>
        ) : eligibility ? (
          <>
            <div style={{ color: eligibility.eligible ? "var(--positive)" : "var(--danger)", fontWeight: 500, marginBottom: "0.35rem" }}>
              {eligibility.eligible ? "Within eligibility" : "Exceeds eligibility"}
            </div>
            <div style={{ color: "var(--muted)" }}>
              Savings {formatNaira(eligibility.savingsBalance)} × {eligibility.multiplier} − outstanding{" "}
              {formatNaira(eligibility.outstandingPrincipal)} − guaranteed {formatNaira(eligibility.guaranteedExposure)} ={" "}
              <span className="mono">{formatNaira(eligibility.availableToBorrow)}</span> available
            </div>
          </>
        ) : null}
      </div>

      <button type="submit" className="btn" style={{ alignSelf: "flex-start" }}>
        Submit application
      </button>
    </form>
  );
}
