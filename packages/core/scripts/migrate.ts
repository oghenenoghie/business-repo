import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_core";
  // Defaults to "public" (existing behavior, unchanged for local/CI). Set to
  // e.g. "wagebook" when deploying into a shared database that already has
  // unrelated tables in "public" — every unqualified object in the .sql
  // files below then lands in this schema instead, via search_path.
  const schema = process.env.TARGET_SCHEMA ?? "public";
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`create schema if not exists "${schema}"`);
    await client.query(`set search_path to "${schema}", public`);

    await client.query(`
      create table if not exists schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const dir = path.join(packageRoot, "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      // Keyed as "core/<file>" to match how downstream packages' migrate
      // scripts (ledger, payroll, coop, hotel, school) record core's
      // migrations when they apply core + their own migrations together
      // against a shared database — otherwise running this script standalone
      // and then a downstream one reapplies core's migrations and collides
      // with objects that already exist.
      const key = `core/${file}`;
      const { rows } = await client.query("select 1 from schema_migrations where filename = $1", [key]);
      if (rows.length > 0) continue;

      const rawSql = await readFile(path.join(dir, file), "utf8");
      // The only schema-qualified statements in these files are the trailing
      // GRANTs — everything else resolves through search_path above.
      const sql = rawSql.replaceAll("schema public", `schema "${schema}"`);
      console.log(`applying ${key} into schema "${schema}"`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [key]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }

    // Local/dev/test convenience only — a real deployment rotates this
    // outside version control and sets CORE_APP_USER_PASSWORD from a secret.
    const appUserPassword = process.env.CORE_APP_USER_PASSWORD ?? "app_user";
    const literal = `'${appUserPassword.replace(/'/g, "''")}'`;
    await client.query(`alter role app_user with password ${literal}`);
    // So app_user's own connections (via withUserContext) resolve unqualified
    // table names into this schema too, without any application code change.
    await client.query(`alter role app_user set search_path to "${schema}", public`);
    console.log("app_user password set");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
