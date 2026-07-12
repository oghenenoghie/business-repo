import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString =
      process.env.APP_DATABASE_URL ?? "postgres://app_user:app_user@localhost:5432/bp_core";
    pool = new Pool({ connectionString });
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
