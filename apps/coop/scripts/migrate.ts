import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Ajo's database is core's schema + ledger's schema + this app's own (see
// the root README: "one database per app"). Members/loans/dividends are
// org-scoped through core's has_org_role() and post through ledger's
// accounts/journal_entries, so a from-scratch database needs both applied
// first.
const migrationSets = [
  { pkg: "core", dir: path.join(appRoot, "..", "..", "packages", "core", "migrations") },
  { pkg: "ledger", dir: path.join(appRoot, "..", "..", "packages", "ledger", "migrations") },
  { pkg: "coop", dir: path.join(appRoot, "migrations") },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_coop";
  // Defaults to "public" (existing behavior, unchanged for local/CI). Set to
  // e.g. "ajo" when deploying into a shared database that already has
  // unrelated tables in "public".
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

    for (const set of migrationSets) {
      const files = (await readdir(set.dir)).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        const key = `${set.pkg}/${file}`;
        const { rows } = await client.query("select 1 from schema_migrations where filename = $1", [key]);
        if (rows.length > 0) continue;

        const rawSql = await readFile(path.join(set.dir, file), "utf8");
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
    }

    const appUserPassword = process.env.CORE_APP_USER_PASSWORD ?? "app_user";
    const literal = `'${appUserPassword.replace(/'/g, "''")}'`;
    await client.query(`alter role app_user with password ${literal}`);
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
