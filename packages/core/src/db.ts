import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    // APP_DATABASE_URL is this app's own config; POSTGRES_URL / POSTGRES_URL_NON_POOLING
    // are what the Vercel-Supabase integration writes automatically when connected —
    // accepting them as fallbacks means connecting that integration is enough to fix
    // env vars, with no manual aliasing step in Vercel's dashboard.
    const rawConnectionString =
      process.env.APP_DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_URL_NON_POOLING ??
      "postgres://app_user:app_user@localhost:5432/bp_core";
    const url = new URL(rawConnectionString);
    const requiresTls = url.searchParams.get("sslmode") === "require";
    // pg's ConnectionParameters does `Object.assign({}, config, parse(connectionString))`
    // — the parsed connection string always wins, so a bare sslmode=require
    // in the URL silently overrides any explicit `ssl` option passed
    // alongside it (and pg's own sslmode handling still verifies the chain
    // against Node's default CA store, which doesn't carry hosted Postgres
    // providers' e.g. Supabase's pooler intermediate certs). Strip it from
    // the URL so only the explicit `ssl` option below takes effect.
    url.searchParams.delete("sslmode");
    const connectionString = url.toString();
    const ssl = requiresTls ? { rejectUnauthorized: false } : undefined;
    pool = new Pool({ connectionString, ssl });
  }
  return pool;
}

/**
 * Runs `fn` inside a transaction with `app.current_user_id` set for the
 * duration of that transaction, so RLS policies resolve to `userId`. The
 * connection used is `app_user` — a role with no BYPASSRLS — so policies
 * are actually enforced, not silently skipped because we're the table owner.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.current_user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
