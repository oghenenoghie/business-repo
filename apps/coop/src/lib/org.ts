import type { PoolClient } from "pg";

export interface DemoOrg {
  id: string;
  name: string;
}

export async function getDemoOrg(client: PoolClient): Promise<DemoOrg> {
  const result = await client.query<{ id: string; name: string }>(
    "select id, name from organizations where slug = 'ajo-demo' limit 1",
  );
  const row = result.rows[0];
  if (!row) throw new Error("demo society not found — run pnpm --filter @bp/coop seed:demo first");
  return row;
}
