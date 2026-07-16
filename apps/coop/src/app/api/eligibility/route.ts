import { NextResponse } from "next/server";
import { withUserContext } from "@bp/core";
import { checkEligibility } from "../../../loans.js";
import { getCurrentPersona } from "../../../lib/session.js";
import { getDemoOrg } from "../../../lib/org.js";

// Backs the live eligibility preview on /loans/new — the skill's screen spec
// calls for "eligibility check runs live as you type the amount". The
// authoritative check still happens server-side in applyForLoanAction; this
// is a read-only preview.
export async function GET(request: Request): Promise<NextResponse> {
  const persona = await getCurrentPersona();
  if (!persona) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const url = new URL(request.url);
  const memberId = url.searchParams.get("memberId");
  const amountNaira = Number(url.searchParams.get("amountNaira") ?? "0");
  if (!memberId) return NextResponse.json({ error: "memberId is required" }, { status: 400 });

  const requestedAmount = BigInt(Math.max(0, Math.round(amountNaira * 100)));

  const eligibility = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    return checkEligibility(client, org.id, memberId, requestedAmount);
  });

  return NextResponse.json({
    savingsBalance: eligibility.savingsBalance.toString(),
    multiplier: eligibility.multiplier,
    outstandingPrincipal: eligibility.outstandingPrincipal.toString(),
    guaranteedExposure: eligibility.guaranteedExposure.toString(),
    availableToBorrow: eligibility.availableToBorrow.toString(),
    requestedAmount: eligibility.requestedAmount.toString(),
    eligible: eligibility.eligible,
  });
}
