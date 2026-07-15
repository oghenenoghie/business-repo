"use server";

import { withUserContext } from "@bp/core";
import { redirect } from "next/navigation";
import { postContribution, ContributionAlreadyPostedError } from "../../contributions.js";
import { getDemoOrg } from "../../lib/org.js";
import { getCurrentPersona } from "../../lib/session.js";

export async function postContributionAction(formData: FormData): Promise<void> {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const memberId = String(formData.get("memberId") ?? "");
  const periodYear = Number(formData.get("periodYear"));
  const periodMonth = Number(formData.get("periodMonth"));
  const amountNaira = Number(formData.get("amountNaira"));

  if (!memberId || !periodYear || !periodMonth || !amountNaira || amountNaira <= 0) {
    throw new Error("member, period, and a positive amount are required");
  }

  await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    try {
      await postContribution(client, {
        orgId: org.id,
        memberId,
        periodYear,
        periodMonth,
        amount: BigInt(Math.round(amountNaira * 100)),
      });
    } catch (err) {
      if (err instanceof ContributionAlreadyPostedError) {
        // Idempotent from the UI's point of view — the member already has
        // this month's contribution on record, nothing more to do.
        return;
      }
      throw err;
    }
  });

  redirect("/contributions");
}
