"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DemoPersona } from "../lib/session";
import { logout } from "./login/actions";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/employees", label: "Employees" },
  { href: "/payroll", label: "Payroll" },
];

export function Nav({ persona }: { persona: DemoPersona }) {
  const pathname = usePathname();

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
      <strong>Wagebook</strong>
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            style={{
              color: active ? "var(--text)" : "var(--muted)",
              fontWeight: active ? 600 : 400,
              borderBottom: active ? "2px solid var(--iris)" : "2px solid transparent",
              paddingBottom: "0.2rem",
            }}
          >
            {link.label}
          </Link>
        );
      })}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "1rem" }}>
        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          {persona.name} <span style={{ textTransform: "uppercase" }}>({persona.role})</span>
        </span>
        <form action={logout}>
          <button type="submit" style={{ color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}>
            Log out
          </button>
        </form>
      </div>
    </nav>
  );
}
