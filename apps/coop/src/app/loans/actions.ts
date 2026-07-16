"use server";

import { withUserContext } from "@bp/core";
import { redirect } from "next/navigation";
import {
  LoanEligibilityError,
  addGuarantor,
  applyForLoan,
  approveLoan,
  checkEligibility,
  disburseLoan,
  postRepayment,
} from "../../loans.js";
import type { EligibilityCheck, LoanMethod } from "../../types.js";
import { getDemoOrg } from "../../lib/org.js";
import { getCurrentPersona } from "../../lib/session.js";

function toMinorUnits(naira: number): bigint {
  return BigInt(Math.round(naira * 100));
}

/**
 * Called directly from the client component on the loan application form as
 * the requested amount is typed — bigint fields are stringified since they
 * cross the server-action boundary.
 */
export async function checkEligibilityAction(memberId: string, principalNaira: number): Promise<EligibilityCheck | null> {
  const persona = await getCurrentPersona();
  if (!persona || !memberId || !Number.isFinite(principalNaira) || principalNaira <= 0) return null;

  const result = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    return checkEligibility(client, org.id, memberId, toMinorUnits(principalNaira));
  });

  return {
    savingsBalance: result.savingsBalance.toString(),
    multiplier: result.multiplier,
    outstandingPrincipal: result.outstandingPrincipal.toString(),
    guaranteedExposure: result.guaranteedExposure.toString(),
    availableToBorrow: result.availableToBorrow.toString(),
    requestedAmount: result.requestedAmount.toString(),
    eligible: result.eligible,
  };
}

export async function applyForLoanAction(formData: FormData): Promise<void> {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const memberId = String(formData.get("memberId") ?? "");
  const principalNaira = Number(formData.get("principalNaira"));
  const interestRatePercent = Number(formData.get("interestRatePercent"));
  const tenorMonths = Number(formData.get("tenorMonths"));
  const method = String(formData.get("method") ?? "flat") as LoanMethod;

  if (!memberId || !principalNaira || principalNaira <= 0 || !tenorMonths || tenorMonths < 1) {
    throw new Error("member, a positive principal, and a tenor are required");
  }

  let loanId: string;
  try {
    const loan = await withUserContext(persona.id, async (client) => {
      const org = await getDemoOrg(client);
      return applyForLoan(client, {
        orgId: org.id,
        memberId,
        principal: toMinorUnits(principalNaira),
        interestRate: interestRatePercent / 100,
        tenorMonths,
        method,
      });
    });
    loanId = loan.id;
  } catch (err) {
    if (err instanceof LoanEligibilityError) {
      redirect(`/loans/new?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect(`/loans/${loanId}`);
}

export async function addGuarantorAction(formData: FormData): Promise<void> {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const loanId = String(formData.get("loanId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const amountNaira = Number(formData.get("amountNaira"));

  if (!loanId || !memberId || !amountNaira || amountNaira <= 0) {
    throw new Error("loan, member, and a positive amount are required");
  }

  try {
    await withUserContext(persona.id, (client) =>
      addGuarantor(client, { loanId, memberId, amountGuaranteed: toMinorUnits(amountNaira) }),
    );
  } catch (err) {
    if (err instanceof LoanEligibilityError) {
      redirect(`/loans/${loanId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect(`/loans/${loanId}`);
}

export async function approveLoanAction(formData: FormData): Promise<void> {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const loanId = String(formData.get("loanId") ?? "");
  if (!loanId) throw new Error("loanId is required");

  try {
    await withUserContext(persona.id, (client) => approveLoan(client, loanId, persona.id));
  } catch (err) {
    if (err instanceof LoanEligibilityError) {
      redirect(`/loans/${loanId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect(`/loans/${loanId}`);
}

export async function disburseLoanAction(formData: FormData): Promise<void> {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const loanId = String(formData.get("loanId") ?? "");
  if (!loanId) throw new Error("loanId is required");

  await withUserContext(persona.id, (client) => disburseLoan(client, loanId));
  redirect(`/loans/${loanId}`);
}

export async function postRepaymentAction(formData: FormData): Promise<void> {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const loanId = String(formData.get("loanId") ?? "");
  if (!loanId) throw new Error("loanId is required");

  await withUserContext(persona.id, (client) => postRepayment(client, { loanId }));
  redirect(`/loans/${loanId}`);
}
