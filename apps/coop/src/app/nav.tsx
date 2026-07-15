import Link from "next/link";
import type { DemoPersona } from "../lib/session.js";
import { logout } from "./login/actions.js";

export function Nav({ persona }: { persona: DemoPersona }) {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1.5rem",
        padding: "1rem 1.5rem",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <strong>Ajo</strong>
      <Link href="/dashboard" style={{ color: "var(--muted)" }}>
        Dashboard
      </Link>
      <Link href="/members" style={{ color: "var(--muted)" }}>
        Members
      </Link>
      <Link href="/contributions" style={{ color: "var(--muted)" }}>
        Contributions
      </Link>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "1rem" }}>
        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          {persona.name} <span style={{ textTransform: "uppercase" }}>({persona.role})</span>
        </span>
        <form action={logout}>
          <button
            type="submit"
            style={{ color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}
          >
            Log out
          </button>
        </form>
      </div>
    </nav>
  );
}
