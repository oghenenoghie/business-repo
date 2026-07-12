import { cookies } from "next/headers";
import { DEMO_ADMIN_ID, DEMO_OWNER_ID, DEMO_VIEWER_ID } from "../demoPersonas";

export const SESSION_COOKIE = "wagebook_demo_user";

export interface DemoPersona {
  id: string;
  name: string;
  role: "owner" | "admin" | "viewer";
  blurb: string;
}

// Matches the first three employees seeded by scripts/seed-demo.ts.
export const DEMO_PERSONAS: DemoPersona[] = [
  { id: DEMO_OWNER_ID, name: "Adaeze Okafor", role: "owner", blurb: "Full access — can manage employees, run and approve payroll." },
  { id: DEMO_ADMIN_ID, name: "Tunde Bakare", role: "admin", blurb: "Can run and approve payroll, cannot manage the org itself." },
  { id: DEMO_VIEWER_ID, name: "Ngozi Chukwu", role: "viewer", blurb: "Read-only — can see payroll history but not create a run." },
];

export async function getCurrentPersona(): Promise<DemoPersona | null> {
  const store = await cookies();
  const userId = store.get(SESSION_COOKIE)?.value;
  if (!userId) return null;
  return DEMO_PERSONAS.find((p) => p.id === userId) ?? null;
}
