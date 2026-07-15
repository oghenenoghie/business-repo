import { DEMO_PERSONAS } from "../../lib/session.js";
import { loginAsDemoPersona } from "./actions.js";

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 560, margin: "4rem auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Ajo</h1>
      <p style={{ color: "var(--muted)", marginBottom: "2rem" }}>
        This is a demo login, not real authentication — pick a seeded persona to see the society as they would.{" "}
        <a href="https://github.com/oghenenoghie/business-repo" style={{ color: "var(--iris)" }}>
          Source
        </a>
        .
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {DEMO_PERSONAS.map((persona) => (
          <form key={persona.id} action={loginAsDemoPersona}>
            <input type="hidden" name="personaId" value={persona.id} />
            <button
              type="submit"
              className="card"
              style={{
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: "var(--text)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong>{persona.name}</strong>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem", textTransform: "uppercase" }}>
                  {persona.role}
                </span>
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>{persona.blurb}</div>
            </button>
          </form>
        ))}
      </div>
    </main>
  );
}
