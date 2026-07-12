import { redirect } from "next/navigation";
import { getCurrentPersona } from "../lib/session";

export default async function RootPage() {
  const persona = await getCurrentPersona();
  redirect(persona ? "/dashboard" : "/login");
}
