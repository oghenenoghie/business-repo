"use server";

import { withUserContext } from "@bp/core";
import { redirect } from "next/navigation";
import {
  addGuarantor,
  applyForLoan,
  approveLoan,
  disburseLoan,
  postRepayment,
} from "../../loans.js";
import { getDemoOrg } from "../../lib/org.js";
import { getCurrentPersona } from "../../lib/session.js";

export async function applyForLoanAction(formData: FormData): Promise<void> {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const memberId = String(formData.get("memberId") ?? "");
  const principalNaira = Number(formData.get("principalNaira"));
  const interestRatePercent = Number(formData.get("interestRatePercent"));
  const tenorMonths = Number(formData.get("tenorMonths"));

  if (!memberId || !principalNaira || principalNaira <= 0 || !tenorMonths || tenorMonths <= 0) {
    throw new Error("member, a positive principal, and a tenor are required");
  }

  const loan = await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    return applyForLoan(client, {
      orgId: org.id,
      memberId,
      principal: BigInt(Math.round(principalNaira * 100)),
      interestRate: interestRatePercent / 100,
      tenorMonths,
      method: "flat",
    });
  });

  redirect(`/loans/${loan.id}`);
}

export async function addGuarantorAction(formData: FormData): Promise<void> {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const loanId = String(formData.get("loanId") ?? "");
  const memberId = String(formData.get("guarantorMemberId") ?? "");
  const amountNaira = Number(formData.get("amountGuaranteedNaira"));

  if (!loanId || !memberId || !amountNaira || amountNaira <= 0) {
    throw new Error("a guarantor and a positive amount guaranteed are required");
  }

  await withUserContext(persona.id, (client) =>
    addGuarantor(client, { loanId, memberId, amountGuaranteed: BigInt(Math.round(amountNaira * 100)) }),
  );

  redirect(`/loans/${loanId}`);
}

export async function approveLoanAction(formData: FormData): Promise<void> {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const loanId = String(formData.get("loanId") ?? "");
  if (!loanId) throw new Error("loanId is required");

  await withUserContext(persona.id, (client) => approveLoan(client, loanId, persona.id));

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
