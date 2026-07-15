import { cookies } from "next/headers";
import { DEMO_ADMIN_ID, DEMO_OWNER_ID, DEMO_VIEWER_ID } from "../demoPersonas.js";

export const SESSION_COOKIE = "ajo_demo_user";

export interface DemoPersona {
  id: string;
  name: string;
  role: "owner" | "admin" | "viewer";
  blurb: string;
}

// Matches the personas seeded by scripts/seed-demo.ts.
export const DEMO_PERSONAS: DemoPersona[] = [
  {
    id: DEMO_OWNER_ID,
    name: "Chief Adebayo Fashina",
    role: "owner",
    blurb: "Society chairperson — full access, manages membership and dividends.",
  },
  {
    id: DEMO_ADMIN_ID,
    name: "Mrs. Uche Anyanwu",
    role: "admin",
    blurb: "Treasurer — posts contributions, manages loans, cannot alter membership.",
  },
  {
    id: DEMO_VIEWER_ID,
    name: "Mr. Godwin Etuk",
    role: "viewer",
    blurb: "Committee member — read-only access to the society's records.",
  },
];

export async function getCurrentPersona(): Promise<DemoPersona | null> {
  const store = await cookies();
  const userId = store.get(SESSION_COOKIE)?.value;
  if (!userId) return null;
  return DEMO_PERSONAS.find((p) => p.id === userId) ?? null;
}
