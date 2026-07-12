import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_core";
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const dir = path.join(packageRoot, "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      const { rows } = await client.query("select 1 from schema_migrations where filename = $1", [file]);
      if (rows.length > 0) continue;

      const sql = await readFile(path.join(dir, file), "utf8");
      console.log(`applying ${file}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
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
    console.log("app_user password set");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
