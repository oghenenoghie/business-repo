"use server";

import { withUserContext } from "@bp/core";
import { redirect } from "next/navigation";
import { getDemoOrg } from "../../lib/org.js";
import { getCurrentPersona } from "../../lib/session.js";
import { createMember } from "../../members.js";

export async function createMemberAction(formData: FormData): Promise<void> {
  const persona = await getCurrentPersona();
  if (!persona) redirect("/login");

  const membershipNumber = String(formData.get("membershipNumber") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const joinDate = String(formData.get("joinDate") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!membershipNumber || !fullName || !joinDate) {
    throw new Error("membership number, full name, and join date are required");
  }

  await withUserContext(persona.id, async (client) => {
    const org = await getDemoOrg(client);
    await createMember(client, {
      orgId: org.id,
      membershipNumber,
      fullName,
      joinDate,
      phone: phone || null,
      email: email || null,
    });
  });

  redirect("/members");
}
