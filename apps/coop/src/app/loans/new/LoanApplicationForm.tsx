"use client";

import { useState } from "react";
import { EligibilityPreview } from "./EligibilityPreview.js";
import { applyForLoanAction } from "../actions.js";

interface MemberOption {
  id: string;
  membershipNumber: string;
  fullName: string;
}

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.85rem",
  color: "var(--muted)",
};

const selectStyle: React.CSSProperties = {
  background: "var(--graphite)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "0.5rem 0.65rem",
  color: "var(--text)",
};

export function LoanApplicationForm({ members }: { members: MemberOption[] }) {
  const [memberId, setMemberId] = useState("");
  const [principalNaira, setPrincipalNaira] = useState("");

  return (
    <form action={applyForLoanAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 420 }}>
      <label style={fieldStyle}>
        Member
        <select name="memberId" required style={selectStyle} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="" disabled>
            Select a member
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.membershipNumber} — {m.fullName}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
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

      <EligibilityPreview memberId={memberId} principalNaira={principalNaira} />

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <label style={{ ...fieldStyle, flex: 1 }}>
          Interest rate (% per annum)
          <input name="interestRatePercent" type="number" min="0" step="0.1" defaultValue="15" required />
        </label>
        <label style={{ ...fieldStyle, flex: 1 }}>
          Tenor (months)
          <input name="tenorMonths" type="number" min="1" step="1" defaultValue="12" required />
        </label>
      </div>

      <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
        Flat-rate amortization — interest = principal × rate × (tenor / 12), split evenly across installments.
      </p>

      <button type="submit" className="btn" style={{ alignSelf: "flex-start" }}>
        Submit application
      </button>
    </form>
  );
}
