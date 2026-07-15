"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_PERSONAS, SESSION_COOKIE } from "../../lib/session.js";

export async function loginAsDemoPersona(formData: FormData): Promise<void> {
  const personaId = formData.get("personaId");
  const persona = DEMO_PERSONAS.find((p) => p.id === personaId);
  if (!persona) throw new Error("unknown demo persona");

  const store = await cookies();
  store.set(SESSION_COOKIE, persona.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });

  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
