"use client";

import { useEffect, useState } from "react";

interface EligibilityResponse {
  savingsBalance: string;
  multiplier: number;
  outstandingPrincipal: string;
  guaranteedExposure: string;
  availableToBorrow: string;
  requestedAmount: string;
  eligible: boolean;
}

function formatNaira(minorUnitsStr: string): string {
  const value = BigInt(minorUnitsStr);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}₦${(abs / 100n).toLocaleString("en-NG")}`;
}

/**
 * Live eligibility check as the treasurer picks a member and types an
 * amount — the applyForLoanAction server action re-checks this
 * authoritatively on submit; this is a preview only.
 */
export function EligibilityPreview({ memberId, principalNaira }: { memberId: string; principalNaira: string }) {
  const [result, setResult] = useState<EligibilityResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!memberId) {
      setResult(null);
      return;
    }

    const handle = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ memberId, amountNaira: principalNaira || "0" });
      fetch(`/api/eligibility?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setResult(data))
        .catch(() => setResult(null))
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(handle);
  }, [memberId, principalNaira]);

  if (!memberId) return null;

  return (
    <div
      className="card"
      style={{
        background: "var(--graphite)",
        fontSize: "0.85rem",
        borderColor: result ? (result.eligible ? "var(--positive)" : "var(--danger)") : "var(--line)",
      }}
    >
      {loading && !result && <span style={{ color: "var(--muted)" }}>Checking eligibility…</span>}
      {result && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>Available to borrow</span>
            <span className="mono" style={{ color: result.eligible ? "var(--positive)" : "var(--danger)" }}>
              {formatNaira(result.availableToBorrow)}
            </span>
          </div>
          <div style={{ color: "var(--muted)", fontSize: "0.75rem", lineHeight: 1.6 }}>
            Savings {formatNaira(result.savingsBalance)} × {result.multiplier} − outstanding{" "}
            {formatNaira(result.outstandingPrincipal)} − guaranteed {formatNaira(result.guaranteedExposure)}
          </div>
          {!result.eligible && (
            <p style={{ color: "var(--danger)", marginTop: "0.5rem" }}>
              Requested amount exceeds this member&apos;s available capacity.
            </p>
          )}
        </>
      )}
    </div>
  );
}
