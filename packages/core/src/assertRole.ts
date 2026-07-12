import type { PoolClient } from "pg";

export type OrgRole = "owner" | "admin" | "member" | "viewer";

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Application-layer authorization guard. This is one of three layers
 * (database RLS, this guard, UI) — RLS is the one that actually matters,
 * but this is what gives callers a clean error before a query ever runs.
 */
export async function assertRole(client: PoolClient, orgId: string, allowed: OrgRole[]): Promise<void> {
  const { rows } = await client.query<{ has_org_role: boolean }>(
    "select has_org_role($1, $2) as has_org_role",
    [orgId, allowed],
  );
  if (!rows[0]?.has_org_role) {
    throw new ForbiddenError(`requires role in [${allowed.join(", ")}] on org ${orgId}`);
  }
}
